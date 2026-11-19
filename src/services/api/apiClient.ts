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

  // =========================================================
  // === CRM — CUSTOMERS =====================================
  // =========================================================

  async getCustomers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    lifecycle?: 'LEAD' | 'ACTIVE' | 'INACTIVE';
    type?: 'CORPORATE' | 'INDIVIDUAL';
    branchId?: string;
    ownerId?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/customers?${query.toString()}`);
  }

  async getCustomer(id: string) {
    return this.request<{ data: any }>(`/customers/${id}`);
  }

  async createCustomer(data: {
    customerCode: string;
    name: string;
    kraPin?: string;
    email?: string;
    phone?: string;
    lifecycle?: string;
    type?: string;
    branchId?: string;
    leadSource?: string;
    creditLimit?: number;
    paymentTermsDays?: number;
  }) {
    return this.request<{ data: any }>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCustomer(id: string, data: any) {
    return this.request<{ data: any }>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async archiveCustomer(id: string) {
    return this.request<{ data: any }>(`/customers/${id}/archive`, { method: 'POST' });
  }

  async checkCustomerDuplicates(data: {
    name?: string;
    email?: string;
    kraPin?: string;
    phone?: string;
    excludeId?: string;
  }) {
    return this.request<{ data: any[] }>('/customers/check-duplicates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Customer contacts
  async getCustomerContacts(customerId: string) {
    return this.request<{ data: any[] }>(`/customers/${customerId}/contacts`);
  }

  async createContact(customerId: string, data: any) {
    return this.request<{ data: any }>(`/customers/${customerId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateContact(id: string, data: any) {
    return this.request<{ data: any }>(`/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async archiveContact(id: string) {
    return this.request<{ data: any }>(`/contacts/${id}/archive`, { method: 'POST' });
  }

  async setPrimaryContact(customerId: string, contactId: string) {
    return this.request<{ data: any }>(`/customers/${customerId}/contacts/${contactId}/primary`, {
      method: 'POST',
    });
  }

  // Customer activities
  async getCustomerActivities(customerId: string, params?: { page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(
      `/customers/${customerId}/activities?${query.toString()}`
    );
  }

  async createCustomerActivity(
    customerId: string,
    data: { type: string; summary: string; metadata?: any }
  ) {
    return this.request<{ data: any }>(`/customers/${customerId}/activities`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================
  // === CRM — DEALS =========================================
  // =========================================================

  async getDeals(params?: {
    page?: number;
    limit?: number;
    search?: string;
    stage?: string;
    closeOutcome?: 'WON' | 'LOST';
    assignedToId?: string;
    customerId?: string;
    branchId?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/deals?${query.toString()}`);
  }

  async getDeal(id: string) {
    return this.request<{ data: any }>(`/deals/${id}`);
  }

  async createDeal(data: {
    customerId: string;
    assignedToId: string;
    title: string;
    value: number;
    currency?: string;
    stage?: string;
    winProbability?: number;
    expectedCloseDate?: string;
    source?: string;
  }) {
    return this.request<{ data: any }>('/deals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDeal(id: string, data: any) {
    return this.request<{ data: any }>(`/deals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async moveDealStage(
    id: string,
    data: {
      stage: string;
      probability?: number;
      closeOutcome?: 'WON' | 'LOST';
      lostReason?: string;
      lostNotes?: string;
      finalAmount?: number;
      createQuotation?: boolean;
      version?: number;
    }
  ) {
    return this.request<{ data: any }>(`/deals/${id}/stage`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async reopenDeal(id: string, data: { reason: string }) {
    return this.request<{ data: any }>(`/deals/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDealStageHistory(id: string) {
    return this.request<{ data: any[] }>(`/deals/${id}/stage-history`);
  }

  // =========================================================
  // === CRM — TASKS =========================================
  // =========================================================

  async getTasks(params?: {
    page?: number;
    limit?: number;
    status?: string;
    priority?: string;
    assignedToId?: string;
    customerId?: string;
    dealId?: string;
    dueBefore?: string;
    dueAfter?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[]; pagination: any }>(`/tasks?${query.toString()}`);
  }

  async createTask(data: {
    title: string;
    description?: string;
    priority?: string;
    dueAt?: string;
    assignedToId?: string;
    customerId?: string;
    dealId?: string;
  }) {
    return this.request<{ data: any }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTask(id: string, data: any) {
    return this.request<{ data: any }>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async completeTask(id: string) {
    return this.request<{ data: any }>(`/tasks/${id}/complete`, { method: 'POST' });
  }

  async snoozeTask(id: string, data: { snoozedUntil: string }) {
    return this.request<{ data: any }>(`/tasks/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getUpcomingTasks(params?: { limit?: number }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[] }>(`/tasks/upcoming?${query.toString()}`);
  }

  // =========================================================
  // === CRM — SALES REPS ====================================
  // =========================================================

  async getSalesRepPerformance(params?: {
    periodStart?: string;
    periodEnd?: string;
    userId?: string;
    branchId?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any }>(`/sales-reps/performance?${query.toString()}`);
  }

  async getQuotas(userId: string) {
    return this.request<{ data: any[] }>(`/sales-reps/${userId}/quotas`);
  }

  async createQuota(data: any) {
    return this.request<{ data: any }>('/sales-reps/quotas', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCommissions(userId: string) {
    return this.request<{ data: any[] }>(`/sales-reps/${userId}/commissions`);
  }

  async calculateCommissions(data: { userId: string; periodStart: string; periodEnd: string }) {
    return this.request<{ data: any }>('/sales-reps/commissions/calculate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================
  // === CRM — ANALYTICS =====================================
  // =========================================================

  async getCrmDashboard(params?: { dateRange?: string; branchId?: string; ownerId?: string }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any }>(`/crm/analytics/dashboard?${query.toString()}`);
  }

  async getCrmPipeline(params?: {
    branchId?: string;
    ownerId?: string;
    stage?: string;
    currency?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any }>(`/crm/analytics/pipeline?${query.toString()}`);
  }

  async getCrmRepPerformance(params?: {
    periodStart?: string;
    periodEnd?: string;
    branchId?: string;
  }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[] }>(`/crm/analytics/rep-performance?${query.toString()}`);
  }

  async getCrmCustomerAnalytics(params?: { dateRange?: string; branchId?: string }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any }>(`/crm/analytics/customers?${query.toString()}`);
  }

  // =========================================================
  // === CRM — PREMIUM =======================================
  // =========================================================

  async getSavedViews(params?: { entityType?: string }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[] }>(`/crm/premium/saved-views?${query.toString()}`);
  }

  async createSavedView(data: {
    entityType: string;
    name: string;
    filters: any;
    columns?: string[];
    sortBy?: string;
    sortOrder?: string;
    isDefault?: boolean;
    isShared?: boolean;
  }) {
    return this.request<{ data: any }>('/crm/premium/saved-views', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteSavedView(id: string) {
    return this.request<{ success: boolean }>(`/crm/premium/saved-views/${id}`, {
      method: 'DELETE',
    });
  }

  async getCustomFieldDefs(entityType: string) {
    return this.request<{ data: any[] }>(`/crm/premium/custom-fields/${entityType}`);
  }

  async createCustomFieldDef(data: any) {
    return this.request<{ data: any }>('/crm/premium/custom-fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCustomFieldValues(entityType: string, entityId: string) {
    return this.request<{ data: any[] }>(
      `/crm/premium/custom-fields/${entityType}/${entityId}/values`
    );
  }

  async setCustomFieldValue(
    entityType: string,
    entityId: string,
    data: { definitionId: string; value: any }
  ) {
    return this.request<{ data: any }>(
      `/crm/premium/custom-fields/${entityType}/${entityId}/values`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  async startImport(data: {
    entityType: string;
    rows: any[];
    dryRun?: boolean;
    idempotencyKey?: string;
  }) {
    return this.request<{ data: any }>('/crm/premium/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getImportJob(id: string) {
    return this.request<{ data: any }>(`/crm/premium/import/${id}`);
  }

  async exportCrmData(data: { entityType: string; format?: 'csv' | 'json'; filters?: any }) {
    return this.request<{ data: any }>('/crm/premium/export', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWorkflowRules(params?: { entityType?: string; isActive?: boolean }) {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return this.request<{ data: any[] }>(`/crm/premium/workflows?${query.toString()}`);
  }

  async createWorkflowRule(data: any) {
    return this.request<{ data: any }>('/crm/premium/workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async toggleWorkflowRule(id: string, isActive: boolean) {
    return this.request<{ data: any }>(`/crm/premium/workflows/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ isActive }),
    });
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