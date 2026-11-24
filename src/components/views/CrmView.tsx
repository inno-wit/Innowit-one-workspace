import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Users,
  Briefcase,
  CheckSquare,
  Building2,
  TrendingUp,
  RefreshCw,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import {
  UserRole,
  CustomerRecord,
  CustomerContact,
  DealRecord,
  TaskRecord,
  SalesRepRecord,
  ActivityLogRecord,
  DealStage,
} from '@/types';
import {
  fetchCrmStateFromServer,
  createCustomerOnServer,
  createDealOnServer,
  updateDealStageOnServer,
  createTaskOnServer,
  toggleTaskOnServer,
  updateCustomerOnServer,
  archiveCustomerOnServer,
  createContactOnServer,
  updateContactOnServer,
  loadUiPrefs,
  saveUiPrefs,
  CrmUiPrefs,
} from '@/modules/crm/store';
import {
  SEED_CUSTOMERS,
  SEED_CONTACTS,
  SEED_DEALS,
  SEED_TASKS,
  SEED_SALES_REPS,
  SEED_ACTIVITY_LOGS,
} from '@/data/crmSeed';

import { CrmDashboardView } from '@/components/crm/CrmDashboardView';
import { CustomersDirectoryView } from '@/components/crm/CustomersDirectoryView';
import { DealsKanbanView } from '@/components/crm/DealsKanbanView';
import { TasksManagerView } from '@/components/crm/TasksManagerView';

interface CrmViewProps {
  userFullName: string;
  userRole: UserRole;
  currentPath?: string;
  onNavigate?: (path: string) => void;
  onSyncCustomers?: (customers: CustomerRecord[]) => void;
  onSyncDeals?: (deals: DealRecord[]) => void;
}

type CrmSubTab = 'dashboard' | 'customers' | 'deals' | 'tasks';

interface CrmState {
  customers: CustomerRecord[];
  contacts: CustomerContact[];
  deals: DealRecord[];
  tasks: TaskRecord[];
  salesReps: SalesRepRecord[];
  activityLogs: ActivityLogRecord[];
  isServerSynced: boolean;
}

interface MutationError {
  id: string;
  message: string;
  timestamp: number;
  action: 'create' | 'update' | 'delete' | 'stageChange' | 'toggle';
  entityType: 'customer' | 'deal' | 'task' | 'contact';
  entityId?: string;
}

export function CrmView({
  userFullName,
  userRole,
  currentPath = '/crm/dashboard',
  onNavigate,
  onSyncCustomers,
  onSyncDeals,
}: CrmViewProps) {
  // Load initial seed state (not from localStorage)
  const [crmState, setCrmState] = useState<CrmState>({
    customers: SEED_CUSTOMERS,
    contacts: SEED_CONTACTS,
    deals: SEED_DEALS,
    tasks: SEED_TASKS,
    salesReps: SEED_SALES_REPS,
    activityLogs: SEED_ACTIVITY_LOGS,
    isServerSynced: false,
  });
  
  const [isLoadingServer, setIsLoadingServer] = useState<boolean>(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [mutationErrors, setMutationErrors] = useState<MutationError[]>([]);
  const [uiPrefs, setUiPrefs] = useState<CrmUiPrefs>(() => loadUiPrefs());

  // Persist UI preferences only
  useEffect(() => {
    saveUiPrefs(uiPrefs);
  }, [uiPrefs]);

  // Sync with real server API on mount
  useEffect(() => {
    let mounted = true;
    async function syncWithServer() {
      setIsLoadingServer(true);
      try {
        const serverData = await fetchCrmStateFromServer();
        if (mounted) {
          setCrmState((prev) => ({
            ...prev,
            customers: serverData.customers?.length ? serverData.customers : prev.customers,
            contacts: serverData.contacts?.length ? serverData.contacts : prev.contacts,
            deals: serverData.deals?.length ? serverData.deals : prev.deals,
            tasks: serverData.tasks?.length ? serverData.tasks : prev.tasks,
            isServerSynced: true,
          }));
          setServerError(null);
        }
      } catch (err: any) {
        console.error('CRM Server sync error:', err);
        if (mounted) {
          setServerError('Unable to connect to server. Using local seed data. Changes will not be persisted.');
        }
      } finally {
        if (mounted) {
          setIsLoadingServer(false);
        }
      }
    }

    syncWithServer();
    return () => {
      mounted = false;
    };
  }, []);

  // Determine active tab from URL path
  const getTabFromPath = (path: string): CrmSubTab => {
    if (path.includes('/customers')) return 'customers';
    if (path.includes('/deals')) return 'deals';
    if (path.includes('/tasks')) return 'tasks';
    return 'dashboard';
  };

  const [activeTab, setActiveTab] = useState<CrmSubTab>(() => getTabFromPath(currentPath));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);

  useEffect(() => {
    setActiveTab(getTabFromPath(currentPath));
  }, [currentPath]);

  // Tab change handler - persist to UI prefs
  const handleTabChange = useCallback((tab: CrmSubTab) => {
    setActiveTab(tab);
    setUiPrefs((prev) => ({ ...prev, activeTab: tab }));
    if (onNavigate) {
      if (tab === 'dashboard') onNavigate('/crm/dashboard');
      if (tab === 'customers') onNavigate('/crm/customers');
      if (tab === 'deals') onNavigate('/crm/deals');
      if (tab === 'tasks') onNavigate('/crm/tasks');
    }
  }, [onNavigate]);

  // Mutation error handling
  const addMutationError = useCallback((
    action: MutationError['action'],
    entityType: MutationError['entityType'],
    message: string,
    entityId?: string
  ) => {
    const error: MutationError = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      message,
      timestamp: Date.now(),
      action,
      entityType,
      entityId,
    };
    setMutationErrors((prev) => [...prev, error]);
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      setMutationErrors((prev) => prev.filter((e) => e.id !== error.id));
    }, 10000);
  }, []);

  const dismissMutationError = useCallback((errorId: string) => {
    setMutationErrors((prev) => prev.filter((e) => e.id !== errorId));
  }, []);

  // State mutation helper - NO localStorage for business data
  const updateState = useCallback((updater: (prev: CrmState) => CrmState) => {
    setCrmState((prev) => {
      const updated = updater(prev);
      if (onSyncCustomers) onSyncCustomers(updated.customers);
      if (onSyncDeals) onSyncDeals(updated.deals);
      return updated;
    });
  }, [onSyncCustomers, onSyncDeals]);

  // 1. Add Customer - Server authoritative, rollback on failure
  const handleCreateCustomer = async (newCust: CustomerRecord) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

    try {
      const createdCust = await createCustomerOnServer(newCust);

      const newActivity: ActivityLogRecord = {
        id: `act_${Date.now()}`,
        entityType: 'CUSTOMER',
        entityId: createdCust.id,
        entityName: createdCust.name,
        title: 'Customer Account Created',
        description: `Registered ${createdCust.name} (PIN: ${createdCust.kraPin}) with credit limit of KES ${(createdCust.creditLimitKes || 0).toLocaleString()}.`,
        user: userFullName,
        timestamp,
        type: 'STAGE_CHANGE',
      };

      updateState((prev) => ({
        ...prev,
        customers: [createdCust, ...prev.customers.filter((c) => c.id !== createdCust.id)],
        activityLogs: [newActivity, ...prev.activityLogs],
      }));

      return createdCust;
    } catch (err: any) {
      const message = `Failed to create customer: ${err.message || 'Server error'}`;
      addMutationError('create', 'customer', message);
      throw err; // Re-throw so caller can handle
    }
  };

  // 2. Add Contact to Customer
  const handleAddContact = async (newContact: CustomerContact) => {
    try {
      const createdContact = await createContactOnServer(newContact);
      updateState((prev) => ({
        ...prev,
        contacts: [...prev.contacts, createdContact],
      }));
      return createdContact;
    } catch (err: any) {
      const message = `Failed to add contact: ${err.message || 'Server error'}`;
      addMutationError('create', 'contact', message);
      throw err;
    }
  };

  // 3. Create Deal - Server authoritative, rollback on failure
  const handleCreateDeal = async (newDeal: DealRecord) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

    try {
      const createdDeal = await createDealOnServer(newDeal);

      const newActivity: ActivityLogRecord = {
        id: `act_${Date.now()}`,
        entityType: 'DEAL',
        entityId: createdDeal.id,
        entityName: createdDeal.title,
        title: 'New Deal Added to Pipeline',
        description: `Created opportunity "${createdDeal.title}" for ${createdDeal.customerName} valued at KES ${createdDeal.value.toLocaleString()}.`,
        user: userFullName,
        timestamp,
        type: 'STAGE_CHANGE',
      };

      updateState((prev) => ({
        ...prev,
        deals: [createdDeal, ...prev.deals.filter((d) => d.id !== createdDeal.id)],
        activityLogs: [newActivity, ...prev.activityLogs],
      }));

      return createdDeal;
    } catch (err: any) {
      const message = `Failed to create deal: ${err.message || 'Server error'}`;
      addMutationError('create', 'deal', message);
      throw err;
    }
  };

  // 4. Update Deal Stage - Server authoritative with optimistic UI and rollback
  const handleUpdateDealStage = async (
    dealId: string,
    newStage: DealStage,
    lostReason?: string,
    lostNotes?: string,
    generateQuotation?: boolean
  ) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const targetDeal = crmState.deals.find((d) => d.id === dealId);

    if (!targetDeal) {
      addMutationError('stageChange', 'deal', 'Deal not found', dealId);
      throw new Error('Deal not found');
    }

    // Store previous state for potential rollback
    const previousDeal = { ...targetDeal };
    const previousReps = [...crmState.salesReps];

    // Optimistic local update
    let movedDealTitle = targetDeal.title;
    let movedCustomerName = targetDeal.customerName;
    let dealVal = targetDeal.value;

    const optimisticDeals = crmState.deals.map((d) => {
      if (d.id !== dealId) return d;
      let prob = d.winProbability;
      if (newStage === 'NEW_LEAD') prob = 20;
      if (newStage === 'CONTACTED') prob = 40;
      if (newStage === 'QUALIFIED') prob = 60;
      if (newStage === 'PROPOSAL') prob = 75;
      if (newStage === 'NEGOTIATION') prob = 90;
      if (newStage === 'CLOSED_WON') prob = 100;
      if (newStage === 'CLOSED_LOST') prob = 0;

      return {
        ...d,
        stage: newStage,
        winProbability: prob,
        lostReason: newStage === 'CLOSED_LOST' ? lostReason : undefined,
        lostNotes: newStage === 'CLOSED_LOST' ? lostNotes : undefined,
        wonQuotationNumber:
          newStage === 'CLOSED_WON' && generateQuotation
            ? `QUO-${new Date().getFullYear()}-${String(Math.floor(100 + Math.random() * 900))}`
            : d.wonQuotationNumber,
        updatedAt: timestamp.slice(0, 10),
      };
    });

    let updatedReps = [...crmState.salesReps];
    if (newStage === 'CLOSED_WON') {
      updatedReps = updatedReps.map((r) =>
        r.id === targetDeal.assignedToId
          ? { ...r, achievedRevenueKes: r.achievedRevenueKes + targetDeal.value }
          : r
      );
    }

    const activity: ActivityLogRecord = {
      id: `act_${Date.now()}`,
      entityType: 'DEAL',
      entityId: dealId,
      entityName: movedDealTitle,
      title: `Deal Stage Updated to ${newStage.replace('_', ' ')}`,
      description:
        newStage === 'CLOSED_LOST'
          ? `Deal closed lost for ${movedCustomerName}. Reason: ${lostReason}.`
          : newStage === 'CLOSED_WON'
          ? `Deal WON! KES ${dealVal.toLocaleString()} added to realized sales revenue.`
          : `Opportunity advanced to ${newStage.replace('_', ' ')}.`,
      user: userFullName,
      timestamp,
      type: 'STAGE_CHANGE',
    };

    // Apply optimistic update immediately
    updateState((prev) => ({
      ...prev,
      deals: optimisticDeals,
      salesReps: updatedReps,
      activityLogs: [activity, ...prev.activityLogs],
    }));

    // Server persistence - if fails, rollback
    try {
      const serverUpdated = await updateDealStageOnServer(
        dealId,
        newStage,
        lostReason,
        lostNotes,
        targetDeal.version
      );
      updateState((prev) => ({
        ...prev,
        deals: prev.deals.map((d) => (d.id === dealId ? { ...d, ...serverUpdated } : d)),
      }));
    } catch (err: any) {
      // ROLLBACK: Restore previous state
      updateState((prev) => ({
        ...prev,
        deals: prev.deals.map((d) => (d.id === dealId ? previousDeal : d)),
        salesReps: previousReps,
        activityLogs: prev.activityLogs.filter((a) => a.id !== activity.id),
      }));
      const message = `Failed to update deal stage: ${err.message || 'Server error'}. Changes reverted.`;
      addMutationError('stageChange', 'deal', message, dealId);
      throw err;
    }
  };

  // 5. Create Task - Server authoritative
  const handleCreateTask = async (newTask: TaskRecord) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

    try {
      const createdTask = await createTaskOnServer(newTask);

      const activity: ActivityLogRecord = {
        id: `act_${Date.now()}`,
        entityType: 'TASK',
        entityId: createdTask.id,
        entityName: createdTask.title,
        title: 'Action Task Scheduled',
        description: `Task "${createdTask.title}" assigned to ${createdTask.assignedToName} (Due: ${createdTask.dueDate}).`,
        user: userFullName,
        timestamp,
        type: 'NOTE',
      };

      updateState((prev) => ({
        ...prev,
        tasks: [createdTask, ...prev.tasks.filter((t) => t.id !== createdTask.id)],
        activityLogs: [activity, ...prev.activityLogs],
      }));

      return createdTask;
    } catch (err: any) {
      const message = `Failed to create task: ${err.message || 'Server error'}`;
      addMutationError('create', 'task', message);
      throw err;
    }
  };

  // 6. Toggle Task Status - Server authoritative with rollback
  const handleToggleTaskStatus = async (taskId: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const targetTask = crmState.tasks.find((t) => t.id === taskId);
    const nextStatus = targetTask?.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';

    if (!targetTask) {
      addMutationError('toggle', 'task', 'Task not found', taskId);
      throw new Error('Task not found');
    }

    // Store previous state for rollback
    const previousTask = { ...targetTask };

    // Optimistic update
    updateState((prev) => {
      const updatedTasks = prev.tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: nextStatus as TaskRecord['status'],
          completedAt: nextStatus === 'COMPLETED' ? timestamp : undefined,
        };
      });
      return { ...prev, tasks: updatedTasks };
    });

    try {
      await toggleTaskOnServer(taskId, targetTask.status);
    } catch (err: any) {
      // ROLLBACK
      updateState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? previousTask : t)),
      }));
      const message = `Failed to update task status: ${err.message || 'Server error'}. Changes reverted.`;
      addMutationError('toggle', 'task', message, taskId);
      throw err;
    }
  };

  // 7. Update Customer
  const handleUpdateCustomer = async (customerId: string, updates: Partial<CustomerRecord>) => {
    const targetCustomer = crmState.customers.find((c) => c.id === customerId);
    if (!targetCustomer) throw new Error('Customer not found');

    const previousCustomer = { ...targetCustomer };

    try {
      const updatedCustomer = await updateCustomerOnServer(customerId, updates);
      updateState((prev) => ({
        ...prev,
        customers: prev.customers.map((c) => (c.id === customerId ? updatedCustomer : c)),
      }));
      return updatedCustomer;
    } catch (err: any) {
      updateState((prev) => ({
        ...prev,
        customers: prev.customers.map((c) => (c.id === customerId ? previousCustomer : c)),
      }));
      const message = `Failed to update customer: ${err.message || 'Server error'}. Changes reverted.`;
      addMutationError('update', 'customer', message, customerId);
      throw err;
    }
  };

  // 8. Archive Customer
  const handleArchiveCustomer = async (customerId: string) => {
    const targetCustomer = crmState.customers.find((c) => c.id === customerId);
    if (!targetCustomer) throw new Error('Customer not found');

    const previousCustomer = { ...targetCustomer };

    try {
      await archiveCustomerOnServer(customerId);
      const archivedCustomer = { ...previousCustomer, lifecycle: 'INACTIVE' as const };
      updateState((prev) => ({
        ...prev,
        customers: prev.customers.map((c) => (c.id === customerId ? archivedCustomer : c)),
      }));
    } catch (err: any) {
      const message = `Failed to archive customer: ${err.message || 'Server error'}.`;
      addMutationError('update', 'customer', message, customerId);
      throw err;
    }
  };

  // 9. Update Contact
  const handleUpdateContact = async (contactId: string, updates: Partial<CustomerContact>) => {
    try {
      const updatedContact = await updateContactOnServer(contactId, updates);
      updateState((prev) => ({
        ...prev,
        contacts: prev.contacts.map((c) => (c.id === contactId ? updatedContact : c)),
      }));
      return updatedContact;
    } catch (err: any) {
      const message = `Failed to update contact: ${err.message || 'Server error'}.`;
      addMutationError('update', 'contact', message, contactId);
      throw err;
    }
  };

  // 10. Delete Contact - Not yet implemented (API has archiveContact instead)
  // const handleDeleteContact = async (contactId: string) => { ... }

  return (
    <div className="space-y-5">
      {/* Mutation Error Toasts */}
      {mutationErrors.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md pointer-events-none">
          {mutationErrors.map((error) => (
            <div
              key={error.id}
              className="pointer-events-auto bg-red-50 border border-red-200 rounded-lg p-3 shadow-lg flex items-start gap-2 animate-slide-in"
              role="alert"
            >
              <XCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-800">
                  {error.entityType.charAt(0).toUpperCase() + error.entityType.slice(1)} {error.action} failed
                </p>
                <p className="text-xs text-red-600 mt-0.5">{error.message}</p>
              </div>
              <button
                onClick={() => dismissMutationError(error.id)}
                className="text-red-400 hover:text-red-600 shrink-0"
                aria-label="Dismiss error"
              >
                <XCircle size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Top CRM Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <Users className="text-[#E03616]" size={22} />
              CRM & Sales Pipeline Management
            </h1>
            <Badge variant="slateBlue">Phase 3 Integrated</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[#54657E]">
            Customer directory with KRA compliance, 6-stage Kanban deals pipeline, cross-entity tasks, and executive performance metrics.
          </p>
        </div>

        {/* Quick Nav Status — Live Database Synced */}
        <div className="flex items-center gap-2 font-mono text-xs text-[#54657E]">
          {isLoadingServer ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
              <span>Connecting to PostgreSQL...</span>
            </>
          ) : serverError ? (
            <>
              <AlertCircle className="h-3 w-3 text-amber-500" />
              <span className="text-amber-700">{serverError}</span>
            </>
          ) : crmState.isServerSynced ? (
            <>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>PostgreSQL Core: Connected</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span>Local Seed Data Only</span>
            </>
          )}
        </div>
      </div>

      {/* Primary Sub-Tabs Navigation (Dashboard, Customers, Deals, Tasks) */}
      <div className="flex items-center justify-between border-b border-[#D8E2EC] bg-white px-2 py-1.5 rounded-xl shadow-xs">
        <div className="flex items-center space-x-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => handleTabChange('dashboard')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'bg-[#1B2436] text-white shadow-xs'
                : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'
            }`}
          >
            <BarChart3 size={14} className={activeTab === 'dashboard' ? 'text-[#E03616]' : ''} />
            <span>CRM Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('customers')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'customers'
                ? 'bg-[#1B2436] text-white shadow-xs'
                : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'
            }`}
          >
            <Users size={14} className={activeTab === 'customers' ? 'text-[#E03616]' : ''} />
            <span>Customer Accounts</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'customers'
                  ? 'bg-[#27334D] text-white'
                  : 'bg-[#E8EEF5] text-[#1B2436]'
              }`}
            >
              {crmState.customers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('deals')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'deals'
                ? 'bg-[#1B2436] text-white shadow-xs'
                : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'
            }`}
          >
            <Briefcase size={14} className={activeTab === 'deals' ? 'text-[#E03616]' : ''} />
            <span>6-Stage Deals Kanban</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'deals'
                  ? 'bg-[#27334D] text-white'
                  : 'bg-[#E8EEF5] text-[#1B2436]'
              }`}
            >
              {crmState.deals.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('tasks')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'tasks'
                ? 'bg-[#1B2436] text-white shadow-xs'
                : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'
            }`}
          >
            <CheckSquare size={14} className={activeTab === 'tasks' ? 'text-[#E03616]' : ''} />
            <span>Tasks & Activities</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'tasks'
                  ? 'bg-[#27334D] text-white'
                  : 'bg-[#E8EEF5] text-[#1B2436]'
              }`}
            >
              {crmState.tasks.length}
            </span>
          </button>
        </div>
      </div>

      {/* Render Active Sub-View */}
      {activeTab === 'dashboard' && (
        <CrmDashboardView
          customers={crmState.customers}
          deals={crmState.deals}
          tasks={crmState.tasks}
          salesReps={crmState.salesReps}
          activities={crmState.activityLogs}
          onNavigateTab={handleTabChange}
          onSelectCustomer={(c) => {
            setSelectedCustomer(c);
            handleTabChange('customers');
          }}
        />
      )}

      {activeTab === 'customers' && (
        <CustomersDirectoryView
          customers={crmState.customers}
          contacts={crmState.contacts}
          deals={crmState.deals}
          tasks={crmState.tasks}
          activities={crmState.activityLogs}
          salesReps={crmState.salesReps}
          onCreateCustomer={handleCreateCustomer}
          onAddContact={handleAddContact}
          onUpdateCustomer={handleUpdateCustomer}
          onArchiveCustomer={handleArchiveCustomer}
          onCreateDeal={handleCreateDeal}
          onCreateTask={handleCreateTask}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
        />
      )}

      {activeTab === 'deals' && (
        <DealsKanbanView
          deals={crmState.deals}
          customers={crmState.customers}
          salesReps={crmState.salesReps}
          onCreateDeal={handleCreateDeal}
          onUpdateDealStage={handleUpdateDealStage}
          onSelectCustomer={(c) => {
            setSelectedCustomer(c);
            handleTabChange('customers');
          }}
        />
      )}

      {activeTab === 'tasks' && (
        <TasksManagerView
          tasks={crmState.tasks}
          customers={crmState.customers}
          deals={crmState.deals}
          salesReps={crmState.salesReps}
          onCreateTask={handleCreateTask}
          onToggleTaskStatus={handleToggleTaskStatus}
          onSelectCustomer={(c) => {
            setSelectedCustomer(c);
            handleTabChange('customers');
          }}
        />
      )}
    </div>
  );
}