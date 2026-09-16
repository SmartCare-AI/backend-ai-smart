import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, OtpType, Role, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import type { SessionMeta } from '../common/decorators/session-meta.decorator';
import { firstName as firstNameOf } from '../common/utils/user-name.util';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserEntity } from '../users/entities/user.entity';
import { ProfilesService } from '../users/profiles.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthResponseEntity } from './entities/auth-response.entity';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

const KNOWN_PLATFORMS = new Set(['ios', 'android', 'web']);

/** Loads the role profiles so responses and emails can resolve a name. */
const PROFILE_INCLUDE = {
  patientProfile: true,
  doctorProfile: true,
  caregiverProfile: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly firebase: FirebaseService,
    private readonly profiles: ProfilesService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration & email verification
  // -------------------------------------------------------------------------

  /**
   * Creates the account and its Patient profile. Per the ERD the account row
   * holds no personal identity, so `firstName`/`lastName` from the request are
   * stored on PatientProfile (#2), not on User (#1).
   */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing?.isEmailVerified) {
      throw new ConflictException('An account with this email already exists.');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Re-registering an unverified account overwrites it (the previous
    // attempt never proved ownership of the email address).
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { password, phone: dto.phone ?? null },
        })
      : await this.prisma.user.create({
          data: { email, password, phone: dto.phone ?? null },
        });

    // New accounts are patients by default — give them their medical record.
    await this.profiles.ensurePatientProfile(user.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    if (existing) {
      // Keep the re-submitted name on an unverified retry.
      await this.prisma.patientProfile.updateMany({
        where: { userId: user.id },
        data: { firstName: dto.firstName, lastName: dto.lastName },
      });
    }

    await this.issueOtp(user, OtpType.EMAIL_VERIFICATION, dto.firstName);
    return {
      message:
        'Registration successful. A 6-digit verification code has been sent to your email.',
    };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<AuthResponseEntity> {
    const user = await this.findUserByEmailOrThrow(dto.email);
    if (user.isEmailVerified) {
      throw new BadRequestException(
        'Email is already verified. Please log in.',
      );
    }

    await this.consumeOtp(user.id, OtpType.EMAIL_VERIFICATION, dto.code);

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });
    return this.buildAuthResponse(verified);
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    // Always the same response — never reveal whether an email is registered.
    const generic = {
      message:
        'If an unverified account exists for this email, a new code has been sent.',
    };
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: PROFILE_INCLUDE,
    });
    if (user && !user.isEmailVerified) {
      await this.issueOtp(user, OtpType.EMAIL_VERIFICATION, firstNameOf(user));
    }
    return generic;
  }

  // -------------------------------------------------------------------------
  // Login / logout / refresh
  // -------------------------------------------------------------------------

  async login(dto: LoginDto, meta?: SessionMeta): Promise<AuthResponseEntity> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // bcrypt.compare even when the user is missing → constant-time-ish
    // behaviour, no user-enumeration via response latency.
    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.password ?? '$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsa',
    );
    if (!user || !user.password || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    this.assertAccountUsable(user);
    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Email not verified. Please verify your email or request a new code.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.buildAuthResponse(user, meta);
  }

  async refreshTokens(
    refreshToken: string,
    meta?: SessionMeta,
  ): Promise<AuthResponseEntity> {
    const tokenHash = this.sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    this.assertAccountUsable(stored.user);

    // Rotation: each refresh token is single-use.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.buildAuthResponse(stored.user, meta);
  }

  async logout(
    userId: number,
    refreshToken: string,
  ): Promise<{ message: string }> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash: this.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out successfully.' };
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  async forgotPassword(email: string): Promise<{ message: string }> {
    const generic = {
      message:
        'If an account exists for this email, a password reset code has been sent.',
    };
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: PROFILE_INCLUDE,
    });
    // Social-only accounts (no password) cannot reset a password.
    if (user && user.password) {
      await this.issueOtp(user, OtpType.PASSWORD_RESET, firstNameOf(user));
    }
    return generic;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.findUserByEmailOrThrow(dto.email);
    await this.consumeOtp(user.id, OtpType.PASSWORD_RESET, dto.code);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
          // Proving control of the mailbox also verifies the email.
          isEmailVerified: true,
        },
      }),
      // Force re-login everywhere after a password reset.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password has been reset. Please log in again.' };
  }

  // -------------------------------------------------------------------------
  // Social sign-in (Google / Apple via Firebase)
  // -------------------------------------------------------------------------

  async firebaseLogin(
    dto: FirebaseLoginDto,
    meta?: SessionMeta,
  ): Promise<AuthResponseEntity> {
    const decoded = await this.firebase.verifyIdToken(dto.idToken);

    const signInProvider = decoded.firebase?.sign_in_provider;
    const provider =
      signInProvider === 'apple.com'
        ? AuthProvider.APPLE
        : signInProvider === 'google.com'
          ? AuthProvider.GOOGLE
          : null;
    if (!provider) {
      throw new BadRequestException(
        `Unsupported sign-in provider "${signInProvider}". Only Google and Apple are allowed.`,
      );
    }
    if (!decoded.email) {
      throw new BadRequestException(
        'The social account did not share an email address.',
      );
    }

    const email = decoded.email.toLowerCase();
    let user = await this.prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });

    // Name parts from the social profile — only used when we have to create
    // the patient profile ourselves. `decoded.name` is loosely typed by
    // firebase-admin, so narrow it before touching it.
    const socialName = typeof decoded.name === 'string' ? decoded.name : '';
    const [socialFirstName = 'Shifaa', ...rest] = socialName
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const socialLastName = rest.join(' ') || 'User';

    if (!user) {
      // Link to an existing email account, or provision a new one.
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      user = byEmail
        ? await this.prisma.user.update({
            where: { id: byEmail.id },
            data: {
              firebaseUid: decoded.uid,
              isEmailVerified: true,
              avatarUrl: byEmail.avatarUrl ?? decoded.picture ?? null,
            },
          })
        : await this.prisma.user.create({
            data: {
              email,
              firebaseUid: decoded.uid,
              provider,
              avatarUrl: decoded.picture ?? null,
              isEmailVerified: true,
            },
          });
    }

    this.assertAccountUsable(user);

    // Social accounts default to PATIENT — ensure the medical record exists.
    if (user.role === Role.PATIENT) {
      await this.profiles.ensurePatientProfile(user.id, {
        firstName: socialFirstName,
        lastName: socialLastName,
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.buildAuthResponse(user, meta);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** ERD User.Status gate — INACTIVE and SUSPENDED accounts cannot sign in. */
  private assertAccountUsable(user: User): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account has been deactivated.');
    }
  }

  private async buildAuthResponse(
    user: User,
    meta?: SessionMeta,
  ): Promise<AuthResponseEntity> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    // Opaque random refresh token — only its hash touches the database.
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTtlDays = this.config.get<number>('JWT_REFRESH_TTL_DAYS', 7);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000),
        userAgent: meta?.userAgent?.slice(0, 255) ?? null,
        ip: meta?.ip ?? null,
        platform: this.normalizePlatform(meta?.platform),
      },
    });

    const withProfiles = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: PROFILE_INCLUDE,
    });

    return {
      user: UserEntity.fromUser(withProfiles),
      accessToken,
      refreshToken,
    };
  }

  /** Generates a 6-digit code, emails it, and stores only its hash. */
  private async issueOtp(
    user: User,
    type: OtpType,
    recipientName: string,
  ): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.prisma.$transaction([
      // A new code invalidates all previous ones of the same type.
      this.prisma.otpCode.deleteMany({ where: { userId: user.id, type } }),
      this.prisma.otpCode.create({
        data: {
          userId: user.id,
          type,
          codeHash: this.sha256(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      }),
    ]);

    if (type === OtpType.EMAIL_VERIFICATION) {
      await this.mail.sendVerificationCode(user.email, recipientName, code);
    } else {
      await this.mail.sendPasswordResetCode(user.email, recipientName, code);
    }
  }

  /** Validates a code and marks it consumed; throws on any failure. */
  private async consumeOtp(
    userId: number,
    type: OtpType,
    code: string,
  ): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, type, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      throw new BadRequestException(
        'Code is invalid or has expired. Please request a new one.',
      );
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }
    if (otp.codeHash !== this.sha256(code)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect code.');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  private async findUserByEmailOrThrow(email: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      // Same message as a wrong code — no account enumeration.
      throw new BadRequestException(
        'Code is invalid or has expired. Please request a new one.',
      );
    }
    return user;
  }

  /** Unknown or missing values become null — the header is never trusted. */
  private normalizePlatform(value?: string): string | null {
    const normalized = value?.trim().toLowerCase();
    return normalized && KNOWN_PLATFORMS.has(normalized) ? normalized : null;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
