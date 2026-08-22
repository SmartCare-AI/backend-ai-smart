import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { NotificationType } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

/**
 * Real-time gateway for chat + WebRTC call signaling.
 *
 * Connect (Socket.IO client):
 *   io('https://artsoraback.tech', { auth: { token: '<accessToken>' } })
 *
 * Client → server events:
 *   chat:join    {chatId}                    join a chat room (must be participant)
 *   chat:leave   {chatId}
 *   chat:send    {chatId, text?, fileId?}    send a message
 *   chat:typing  {chatId, isTyping}          typing indicator
 *   chat:read    {chatId}                    mark chat read
 *   call:invite  {chatId, callType}          start a video/audio call
 *   call:accept  {chatId} · call:decline {chatId} · call:end {chatId}
 *   call:signal  {chatId, signal}            WebRTC offer/answer/ICE relay
 *
 * Server → client events:
 *   chat:message {message}                   new message in a joined room
 *   chat:typing  {chatId, userId, isTyping}
 *   chat:read    {chatId, userId, at}
 *   call:*       relayed with {from: userId, ...payload}
 *   error        {message}
 *
 * Global guards do NOT apply to gateways — authentication happens on the
 * handshake here; every event handler re-checks room membership.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  /** userId → live socket ids (presence). */
  private readonly online = new Map<number, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle (handshake = authentication)
  // -------------------------------------------------------------------------

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('missing token');

      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true },
      });
      if (!user || !user.isActive) throw new Error('account not found');

      client.data.userId = user.id;
      await client.join(`user:${user.id}`);
      const sockets = this.online.get(user.id) ?? new Set<string>();
      sockets.add(client.id);
      this.online.set(user.id, sockets);
    } catch {
      client.emit('error', { message: 'Authentication failed.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as number | undefined;
    if (!userId) return;
    const sockets = this.online.get(userId);
    sockets?.delete(client.id);
    if (sockets && sockets.size === 0) this.online.delete(userId);
  }

  isOnline(userId: number): boolean {
    return this.online.has(userId);
  }

  // -------------------------------------------------------------------------
  // Chat events
  // -------------------------------------------------------------------------

  @SubscribeMessage('chat:join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number },
  ) {
    const userId = client.data.userId as number;
    const chatId = Number(body?.chatId);
    if (!chatId) return this.fail(client, 'chatId required');
    try {
      await this.chatService.assertParticipant(userId, chatId);
    } catch {
      return this.fail(client, 'Not a participant of this chat.');
    }
    await client.join(this.room(chatId));
    return { joined: chatId };
  }

  @SubscribeMessage('chat:leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number },
  ) {
    const chatId = Number(body?.chatId);
    if (chatId) await client.leave(this.room(chatId));
    return { left: chatId };
  }

  @SubscribeMessage('chat:send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; text?: string; fileId?: number },
  ) {
    const userId = client.data.userId as number;
    const chatId = Number(body?.chatId);
    if (!chatId) return this.fail(client, 'chatId required');
    try {
      const message = await this.chatService.sendMessage(userId, chatId, {
        text: typeof body.text === 'string' ? body.text : undefined,
        fileId: body.fileId ? Number(body.fileId) : undefined,
      });
      await this.dispatchMessage(chatId, message);
      return { delivered: message.id };
    } catch (err) {
      return this.fail(client, (err as Error).message);
    }
  }

  @SubscribeMessage('chat:typing')
  onTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; isTyping?: boolean },
  ) {
    const chatId = Number(body?.chatId);
    if (!chatId || !client.rooms.has(this.room(chatId))) return;
    client.to(this.room(chatId)).volatile.emit('chat:typing', {
      chatId,
      userId: client.data.userId as number,
      isTyping: !!body.isTyping,
    });
  }

  @SubscribeMessage('chat:read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number },
  ) {
    const userId = client.data.userId as number;
    const chatId = Number(body?.chatId);
    if (!chatId) return this.fail(client, 'chatId required');
    try {
      await this.chatService.markRead(userId, chatId);
      client.to(this.room(chatId)).emit('chat:read', {
        chatId,
        userId,
        at: new Date().toISOString(),
      });
      return { read: chatId };
    } catch (err) {
      return this.fail(client, (err as Error).message);
    }
  }

  // -------------------------------------------------------------------------
  // WebRTC call signaling (P2P — the server only relays)
  // -------------------------------------------------------------------------

  @SubscribeMessage('call:invite')
  async onCallInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; callType?: 'video' | 'audio' },
  ) {
    const userId = client.data.userId as number;
    const chatId = Number(body?.chatId);
    if (!chatId) return this.fail(client, 'chatId required');
    try {
      await this.chatService.assertParticipant(userId, chatId);
    } catch {
      return this.fail(client, 'Not a participant of this chat.');
    }

    const callType = body.callType === 'audio' ? 'audio' : 'video';
    client.to(this.room(chatId)).emit('call:invite', { from: userId, chatId, callType });

    // Ring offline participants via push so the phone wakes up.
    const caller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const others = (await this.chatService.participantUserIds(chatId)).filter(
      (id) => id !== userId && !this.isOnline(id),
    );
    await this.notifications.notifyMany(others, {
      type: NotificationType.CHAT,
      title: `Incoming ${callType} call`,
      body: `${caller?.firstName ?? 'Someone'} ${caller?.lastName ?? ''} is calling you.`,
      data: { screen: 'call', chatId: String(chatId) },
    });
    return { ringing: chatId };
  }

  @SubscribeMessage('call:accept')
  onCallAccept(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: number }) {
    this.relay(client, body?.chatId, 'call:accept', {});
  }

  @SubscribeMessage('call:decline')
  onCallDecline(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: number }) {
    this.relay(client, body?.chatId, 'call:decline', {});
  }

  @SubscribeMessage('call:end')
  onCallEnd(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: number }) {
    this.relay(client, body?.chatId, 'call:end', {});
  }

  @SubscribeMessage('call:signal')
  onCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; signal?: unknown },
  ) {
    this.relay(client, body?.chatId, 'call:signal', { signal: body?.signal });
  }

  // -------------------------------------------------------------------------
  // Used by the REST controller too (messages sent over HTTP still appear
  // in real time and push offline participants)
  // -------------------------------------------------------------------------

  async dispatchMessage(
    chatId: number,
    message: { id: number; senderId: number; text: string; sender: { firstName: string; lastName: string } },
  ) {
    this.server.to(this.room(chatId)).emit('chat:message', message);

    const offline = (await this.chatService.participantUserIds(chatId)).filter(
      (id) => id !== message.senderId && !this.isOnline(id),
    );
    if (offline.length > 0) {
      await this.notifications.notifyMany(offline, {
        type: NotificationType.CHAT,
        title: `${message.sender.firstName} ${message.sender.lastName}`,
        body: message.text ? message.text.slice(0, 120) : '📎 Attachment',
        data: { screen: 'chat', id: String(chatId) },
      });
    }
  }

  // -------------------------------------------------------------------------

  private relay(client: Socket, rawChatId: unknown, event: string, payload: Record<string, unknown>) {
    const chatId = Number(rawChatId);
    // Membership was proven at chat:join — only joined sockets can relay.
    if (!chatId || !client.rooms.has(this.room(chatId))) return;
    client.to(this.room(chatId)).emit(event, {
      from: client.data.userId as number,
      chatId,
      ...payload,
    });
  }

  private room(chatId: number): string {
    return `chat:${chatId}`;
  }

  private fail(client: Socket, message: string) {
    client.emit('error', { message });
    return { error: message };
  }
}
