import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Headers,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { AuthService } from './auth.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthResponseEntity } from './entities/auth-response.entity';

// Stricter limits for endpoints that send emails or accept credentials.
const STRICT = { default: { limit: 5, ttl: 60_000 } };
const EMAIL_SENDING = { default: { limit: 3, ttl: 60_000 } };

@ApiTags('Auth')
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('register')
  @ApiOperation({
    summary: 'Register with email & password',
    description:
      'Creates an account and emails a 6-digit verification code (valid 10 minutes). The account cannot log in until the email is verified via POST /auth/verify-email.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered and verified.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(STRICT)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email with the 6-digit code',
    description:
      'Confirms the code sent at registration. On success the account is activated and tokens are returned (auto-login).',
  })
  @ApiResponse({ status: 200, type: AuthResponseEntity })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or already-used code.' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend the email verification code',
    description:
      'Invalidates any previous code and sends a fresh one. Response is identical whether or not the email exists (no account enumeration).',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email & password',
    description:
      'Returns an access token (15 min) and a rotating refresh token (7 days). Requires a verified email.',
  })
  @ApiResponse({ status: 200, type: AuthResponseEntity })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 403, description: 'Email not verified or account deactivated.' })
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    return this.authService.login(dto, { userAgent, ip });
  }

  @Public()
  @Throttle(STRICT)
  @Post('social/firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in / sign up with Google or Apple (Firebase)',
    description:
      'The mobile app signs in with Google/Apple through Firebase Auth, then sends the Firebase ID token here. The server verifies it, creates or links the account, and returns SmartCare tokens. Social emails are treated as verified.',
  })
  @ApiResponse({ status: 200, type: AuthResponseEntity })
  @ApiResponse({ status: 401, description: 'Invalid or expired Firebase ID token.' })
  @ApiResponse({ status: 503, description: 'Firebase is not configured on the server.' })
  firebaseLogin(
    @Body() dto: FirebaseLoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    return this.authService.firebaseLogin(dto, { userAgent, ip });
  }

  @Public()
  @Throttle(STRICT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh the token pair',
    description:
      'Exchanges a valid refresh token for a new access + refresh pair. Refresh tokens are single-use (rotation): the submitted token is revoked.',
  })
  @ApiResponse({ status: 200, type: AuthResponseEntity })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or already-used refresh token.' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    return this.authService.refreshTokens(dto.refreshToken, { userAgent, ip });
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout (revoke a refresh token)',
    description:
      'Revokes the given refresh token for the authenticated user. The access token stays valid until it expires (max 15 min).',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.logout(user.id, dto.refreshToken);
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset code',
    description:
      'Emails a 6-digit reset code (valid 10 minutes). Response is identical whether or not the email exists (no account enumeration).',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password with the emailed code',
    description:
      'Sets a new password and revokes every active session (all refresh tokens) for security.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or already-used code.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
