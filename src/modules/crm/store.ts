import {
  CustomerRecord,
  CustomerContact,
  DealRecord,
  TaskRecord,
  SalesRepRecord,
  ActivityLogRecord,
} from '@/types';
import {
  SEED_CUSTOMERS,
  SEED_CONTACTS,
  SEED_DEALS,
  SEED_TASKS,
  SEED_SALES_REPS,
  SEED_ACTIVITY_LOGS,
} from '@/data/crmSeed';
import { apiClient } from '@/services/api/apiClient';

const STORAGE_KEY = 'innowit_crm_v3';

export interface CrmState {
  customers: CustomerRecord[];
  contacts: CustomerContact[];
  deals: DealRecord[];
  tasks: TaskRecord[];
  salesReps: SalesRepRecord[];
  activityLogs: ActivityLogRecord[];
  isServerSynced?: boolean;
}

export function mapServerCustomer(c: any): CustomerRecord {
  return {
    id: c.id,
    customerCode: c.customerCode,
    name: c.name,
    companyName: c.companyName || undefined,
    kraPin: c.kraPin || '',
    email: c.email || '',
    phone: c.phone || '',
    city: c.billingAddress || 'Nairobi',
    billingAddress: c.billingAddress,
    creditLimitKes: Number(c.creditLimit || 0),
    paymentTermsDays: c.paymentTermsDays || 30,
    totalRevenueKes: Number(c.totalRevenueKes || 0),
    outstandingBalanceKes: Number(c.outstandingBalanceKes || 0),
    status: c.lifecycle === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    businessType: c.type || 'CORPORATE',
    lifecycle: c.lifecycle || 'LEAD',
    leadSource: c.leadSource,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : undefined,
  };
}

export function mapServerDeal(d: any): DealRecord {
  const isWon = d.closeOutcome === 'WON' || d.stage === 'CLOSED_WON';
  const isLost = d.closeOutcome === 'LOST' || d.stage === 'CLOSED_LOST';
  let stage = d.stage;
  if (d.stage === 'CLOSED') {
    stage = isWon ? 'CLOSED_WON' : 'CLOSED_LOST';
  }

  return {
    id: d.id,
    customerId: d.customerId,
    customerName: d.customer?.name || 'Unknown Client',
    customerPin: d.customer?.kraPin,
    assignedToId: d.assignedToId,
    assignedToName: d.assignedTo?.fullName || 'Assigned Rep',
    assignedToAvatar: '',
    title: d.title,
    value: Number(d.value || 0),
    currency: d.currency || 'KES',
    stage,
    closeOutcome: d.closeOutcome || undefined,
    winProbability: d.winProbability ?? 20,
    expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
    lostReason: d.lostReason || undefined,
    lostNotes: d.lostNotes || undefined,
    version: d.version ?? 1,
    createdAt: d.createdAt ? d.createdAt.slice(0, 10) : '',
    updatedAt: d.updatedAt ? d.updatedAt.slice(0, 10) : '',
    notes: d.source || undefined,
  };
}

export function mapServerTask(t: any): TaskRecord {
  return {
    id: t.id,
    title: t.title,
    description: t.description || undefined,
    priority: t.priority || 'MEDIUM',
    status: t.status === 'COMPLETED' ? 'COMPLETED' : (t.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING'),
    dueDate: t.dueAt ? t.dueAt.slice(0, 10) : (t.dueDate ? t.dueDate.slice(0, 10) : ''),
    assignedToId: t.assignedToId,
    assignedToName: t.assignedTo?.fullName || 'Assigned User',
    customerId: t.customerId || undefined,
    customerName: t.customer?.name || undefined,
    dealId: t.dealId || undefined,
    dealTitle: t.deal?.title || undefined,
    completedAt: t.completedAt ? t.completedAt.slice(0, 10) : undefined,
    createdAt: t.createdAt ? t.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

export function loadCrmState(): CrmState {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.customers && parsed.deals && parsed.tasks) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to load CRM state from localStorage:', err);
  }

  return {
    customers: SEED_CUSTOMERS,
    contacts: SEED_CONTACTS,
    deals: SEED_DEALS,
    tasks: SEED_TASKS,
    salesReps: SEED_SALES_REPS,
    activityLogs: SEED_ACTIVITY_LOGS,
    isServerSynced: false,
  };
}

export function saveCrmState(state: CrmState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Failed to save CRM state to localStorage:', err);
  }
}

// ============================================================================
// SERVER ASYNC SYNC METHODS
// ============================================================================

export async function fetchCrmStateFromServer(): Promise<Partial<CrmState>> {
  const result: Partial<CrmState> = {};

  try {
    const custRes = await apiClient.getCustomers({ limit: 100 });
    if (custRes?.data) {
      result.customers = custRes.data.map(mapServerCustomer);
    }
  } catch (e) {
    console.warn('Failed to load customers from server:', e);
  }

  try {
    const dealsRes = await apiClient.getDeals({ limit: 100 });
    if (dealsRes?.data) {
      result.deals = dealsRes.data.map(mapServerDeal);
    }
  } catch (e) {
    console.warn('Failed to load deals from server:', e);
  }

  try {
    const tasksRes = await apiClient.getTasks({ limit: 100 });
    if (tasksRes?.data) {
      result.tasks = tasksRes.data.map(mapServerTask);
    }
  } catch (e) {
    console.warn('Failed to load tasks from server:', e);
  }

  return result;
}

export async function createCustomerOnServer(newCust: CustomerRecord): Promise<CustomerRecord> {
  const payload = {
    customerCode: newCust.customerCode || `CUST-${Date.now().toString().slice(-4)}`,
    name: newCust.name,
    companyName: newCust.companyName,
    kraPin: newCust.kraPin || undefined,
    email: newCust.email || undefined,
    phone: newCust.phone || undefined,
    billingAddress: newCust.billingAddress || newCust.city,
    creditLimit: newCust.creditLimitKes || 0,
    paymentTermsDays: newCust.paymentTermsDays || 30,
    lifecycle: newCust.lifecycle || 'LEAD',
    type: newCust.businessType || 'CORPORATE',
    leadSource: newCust.leadSource,
  };

  const res = await apiClient.createCustomer(payload);
  return mapServerCustomer(res.data);
}

export async function createDealOnServer(newDeal: DealRecord): Promise<DealRecord> {
  let serverStage: any = newDeal.stage;
  let closeOutcome: 'WON' | 'LOST' | undefined = undefined;
  if (newDeal.stage === 'CLOSED_WON') {
    serverStage = 'CLOSED';
    closeOutcome = 'WON';
  } else if (newDeal.stage === 'CLOSED_LOST') {
    serverStage = 'CLOSED';
    closeOutcome = 'LOST';
  }

  const payload = {
    customerId: newDeal.customerId,
    assignedToId: newDeal.assignedToId,
    title: newDeal.title,
    value: newDeal.value,
    currency: newDeal.currency,
    stage: serverStage,
    closeOutcome,
    winProbability: newDeal.winProbability,
    expectedCloseDate: newDeal.expectedCloseDate ? `${newDeal.expectedCloseDate}T00:00:00.000Z` : undefined,
    source: newDeal.notes,
  };

  const res = await apiClient.createDeal(payload);
  return mapServerDeal(res.data);
}

export async function updateDealStageOnServer(
  dealId: string,
  newStage: string,
  lostReason?: string,
  lostNotes?: string,
  version?: number
): Promise<DealRecord> {
  let stage = newStage;
  let closeOutcome: 'WON' | 'LOST' | undefined = undefined;
  if (newStage === 'CLOSED_WON') {
    stage = 'CLOSED';
    closeOutcome = 'WON';
  } else if (newStage === 'CLOSED_LOST') {
    stage = 'CLOSED';
    closeOutcome = 'LOST';
  }

  const res = await apiClient.moveDealStage(dealId, {
    stage,
    closeOutcome,
    lostReason,
    lostNotes,
    version,
  });

  return mapServerDeal(res.data);
}

export async function createTaskOnServer(newTask: TaskRecord): Promise<TaskRecord> {
  const payload = {
    title: newTask.title,
    description: newTask.description,
    priority: newTask.priority,
    dueAt: newTask.dueDate ? `${newTask.dueDate}T00:00:00.000Z` : undefined,
    assignedToId: newTask.assignedToId,
    customerId: newTask.customerId,
    dealId: newTask.dealId,
  };

  const res = await apiClient.createTask(payload);
  return mapServerTask(res.data);
}

export async function toggleTaskOnServer(taskId: string, currentStatus: string): Promise<TaskRecord> {
  if (currentStatus === 'COMPLETED') {
    const res = await apiClient.updateTask(taskId, { status: 'PENDING' });
    return mapServerTask(res.data);
  } else {
    const res = await apiClient.completeTask(taskId);
    return mapServerTask(res.data);
  }
}
