import { getAccessToken } from '../../utils/auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = getAccessToken();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ 
        error: 'Request failed', 
        code: 'REQUEST_FAILED' 
      }));
      throw new ApiError(response.status, error.code, error.error, error.details);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // Channels
  async getChannels(params?: { page?: number; limit?: number; search?: string; archived?: boolean; branchId?: string }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/channels?${query.toString()}`);
  }

  async getChannel(id: string) {
    return this.request<{ data: any }>(`/channels/${id}`);
  }

  async createChannel(data: { name: string; description?: string; topic?: string; isPrivate?: boolean; branchId?: string }) {
    return this.request<{ data: any }>('/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateChannel(id: string, data: any) {
    return this.request<{ data: any }>(`/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async archiveChannel(id: string) {
    return this.request<{ data: any }>(`/channels/${id}/archive`, { method: 'POST' });
  }

  async unarchiveChannel(id: string) {
    return this.request<{ data: any }>(`/channels/${id}/unarchive`, { method: 'POST' });
  }

  async deleteChannel(id: string) {
    return this.request<{ message: string }>(`/channels/${id}`, { method: 'DELETE' });
  }

  async getChannelMembers(channelId: string) {
    return this.request<{ data: any[] }>(`/channels/${channelId}/members`);
  }

  async addChannelMember(channelId: string, userId: string) {
    return this.request<{ data: any }>(`/channels/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  async removeChannelMember(channelId: string, userId: string) {
    return this.request<{ message: string }>(`/channels/${channelId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  // Conversations (DMs)
  async getConversations(params?: { page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/conversations?${query.toString()}`);
  }

  async getConversation(id: string) {
    return this.request<{ data: any }>(`/conversations/${id}`);
  }

  async createConversation(recipientId: string) {
    return this.request<{ data: any }>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ recipientId }),
    });
  }

  async createGroupConversation(name: string, participantIds: string[]) {
    return this.request<{ data: any }>('/conversations/group', {
      method: 'POST',
      body: JSON.stringify({ name, participantIds }),
    });
  }

  async markConversationRead(conversationId: string, messageId: string) {
    return this.request<{ success: boolean }>(`/conversations/${conversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    });
  }

  // Messages
  async getMessages(params: { 
    channelId?: string; 
    conversationId?: string; 
    recipientId?: string;
    cursor?: string;
    limit?: number;
    direction?: 'before' | 'after';
  }) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.append(key, String(value));
    });
    return this.request<{ data: any[]; pagination: any }>(`/messages?${query.toString()}`);
  }

  async searchMessages(params: { q: string; channelId?: string; conversationId?: string; limit?: number }) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.append(key, String(value));
    });
    return this.request<{ data: any[] }>(`/messages/search?${query.toString()}`);
  }

  async getMessage(id: string) {
    return this.request<{ data: any }>(`/messages/${id}`);
  }

  async sendMessage(data: {
    channelId?: string;
    conversationId?: string;
    recipientId?: string;
    content: string;
    parentId?: string;
    idempotencyKey: string;
  }) {
    return this.request<{ data: any; existing: boolean }>('/messages', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async editMessage(id: string, content: string) {
    return this.request<{ data: any }>(`/messages/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(id: string, hard = false) {
    return this.request<{ message: string }>(`/messages/${id}?hard=${hard}`, {
      method: 'DELETE',
    });
  }

  async pinMessage(id: string) {
    return this.request<{ data: any }>(`/messages/${id}/pin`, { method: 'POST' });
  }

  async unpinMessage(id: string) {
    return this.request<{ data: any }>(`/messages/${id}/pin`, { method: 'DELETE' });
  }

  async addReaction(id: string, emoji: string) {
    return this.request<{ data: any }>(`/messages/${id}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  async removeReaction(id: string, emoji: string) {
    return this.request<{ data: any }>(`/messages/${id}/reactions/${emoji}`, {
      method: 'DELETE',
    });
  }

  async getReactions(id: string) {
    return this.request<{ data: any[] }>(`/messages/${id}/reactions`);
  }

  async getThread(parentId: string, params?: { cursor?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any }>(`/messages/${parentId}/thread?${query.toString()}`);
  }

  // Notifications
  async getNotifications(params?: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/notifications?${query.toString()}`);
  }

  async getUnreadNotificationCount() {
    return this.request<{ data: { count: number } }>('/notifications/unread-count');
  }

  async markNotificationRead(id: string) {
    return this.request<{ data: any }>(`/notifications/${id}/read`, { method: 'POST' });
  }

  async markAllNotificationsRead() {
    return this.request<{ success: boolean }>('/notifications/read-all', { method: 'POST' });
  }

  async getNotificationPreferences() {
    return this.request<{ data: any }>('/notifications/preferences');
  }

  async updateNotificationPreferences(data: any) {
    return this.request<{ data: any }>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Attachments
  async initAttachmentUpload(data: {
    fileName: string;
    mimeType: string;
    size: number;
    checksum: string;
    channelId?: string;
    messageId?: string;
  }) {
    return this.request<{ data: any }>('/attachments/init', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async completeAttachmentUpload(id: string) {
    return this.request<{ data: any }>(`/attachments/${id}/complete`, { method: 'POST' });
  }

  async getAttachment(id: string) {
    return this.request<{ data: any }>(`/attachments/${id}`);
  }

  async downloadAttachment(id: string) {
    return this.request<{ data: { downloadUrl: string; fileName: string; mimeType: string } }>(`/attachments/${id}/download`);
  }

  async streamAttachment(id: string): Promise<Response> {
    const token = getAccessToken();
    const response = await fetch(`${this.baseUrl}/attachments/${id}/stream`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Failed to stream attachment');
    return response;
  }

  async deleteAttachment(id: string) {
    return this.request<{ success: boolean }>(`/attachments/${id}`, { method: 'DELETE' });
  }

  // Meetings
  async getMeetings(params?: { channelId?: string; status?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/meetings?${query.toString()}`);
  }

  async getMeeting(id: string) {
    return this.request<{ data: any }>(`/meetings/${id}`);
  }

  async createMeeting(data: {
    channelId?: string;
    title?: string;
    meetingType: 'DIRECT' | 'GROUP' | 'CHANNEL';
    participantIds?: string[];
  }) {
    return this.request<{ data: any }>('/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async joinMeeting(id: string) {
    return this.request<{ data: any }>(`/meetings/${id}/join`, { method: 'POST' });
  }

  async leaveMeeting(id: string) {
    return this.request<{ success: boolean }>(`/meetings/${id}/leave`, { method: 'POST' });
  }

  async endMeeting(id: string) {
    return this.request<{ success: boolean }>(`/meetings/${id}/end`, { method: 'POST' });
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient();