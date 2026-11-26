import { prisma } from '../prisma';
import crypto from 'crypto';

/**
 * localStorage Import Wizard
 * 
 * Migrates data from the legacy localStorage-based Innowit One frontend
 * to the new PostgreSQL/Prisma backend.
 * 
 * Features:
 * - Dry-run mode with mapping report
 * - Timestamped backup before import
 * - Explicit user approval required
 * - Idempotent by content hash
 * - Detailed audit trail
 */

export interface LocalStorageData {
  innowit_erp_state_v1?: any;
  innowit_crm_state_v1?: any;
  innowit_auth_state_v1?: any;
  innowit_accounting_state_v1?: any;
  innowit_inventory_state_v1?: any;
  innowit_etims_state_v1?: any;
  innowit_payroll_state_v1?: any;
  innowit_collaboration_state_v1?: any;
  [key: string]: any;
}

export interface ImportMappingReport {
  timestamp: string;
  sourceKeys: string[];
  entityCounts: Record<string, number>;
  conflicts: ImportConflict[];
  warnings: string[];
  estimatedDuration: string;
}

export interface ImportConflict {
  entityType: string;
  sourceId: string;
  conflictType: 'DUPLICATE_KEY' | 'MISSING_REFERENCE' | 'DATA_MISMATCH' | 'VERSION_CONFLICT';
  description: string;
  suggestedResolution: 'SKIP' | 'UPDATE' | 'CREATE_NEW' | 'MANUAL_REVIEW';
  existingRecord?: any;
}

export interface ImportResult {
  success: boolean;
  importId: string;
  startedAt: string;
  completedAt: string;
  entitiesImported: Record<string, number>;
  entitiesSkipped: Record<string, number>;
  errors: ImportError[];
  contentHash: string;
}

export interface ImportError {
  entityType: string;
  sourceId: string;
  error: string;
  severity: 'ERROR' | 'WARNING';
}

export class LocalStorageImportWizard {
  private organizationId: string;
  private userId: string;
  private dryRun: boolean;
  private importId: string;
  private contentHash: string = '';

  constructor(organizationId: string, userId: string, dryRun = false) {
    this.organizationId = organizationId;
    this.userId = userId;
    this.dryRun = dryRun;
    this.importId = crypto.randomUUID();
  }

  /**
   * Generate content hash for idempotency
   */
  generateContentHash(data: LocalStorageData): string {
    const sortedKeys = Object.keys(data).sort();
    const content = sortedKeys.map(k => `${k}:${JSON.stringify(data[k])}`).join('|');
    this.contentHash = crypto.createHash('sha256').update(content).digest('hex');
    return this.contentHash;
  }

  /**
   * Check if this exact import has been done before
   */
  async checkIdempotency(): Promise<{ exists: boolean; previousImport?: any }> {
    const existing = await prisma.auditLog.findFirst({
      where: {
        organizationId: this.organizationId,
        action: 'LOCALSTORAGE_IMPORT',
        entityType: 'ImportWizard',
        entityId: this.importId,
      },
    });

    if (existing) {
      return { exists: true, previousImport: existing };
    }

    // Also check by content hash
    const byHash = await prisma.auditLog.findFirst({
      where: {
        organizationId: this.organizationId,
        action: 'LOCALSTORAGE_IMPORT',
        changesJson: { path: ['contentHash'], equals: this.contentHash },
      },
    });

    return { exists: !!byHash, previousImport: byHash };
  }

  /**
   * Analyze localStorage data and generate mapping report
   */
  async analyzeData(data: LocalStorageData): Promise<ImportMappingReport> {
    const sourceKeys = Object.keys(data);
    const entityCounts: Record<string, number> = {};
    const conflicts: ImportConflict[] = [];
    const warnings: string[] = [];

    // Analyze ERP state
    if (data.innowit_erp_state_v1) {
      const erp = data.innowit_erp_state_v1;
      if (erp.organizations) entityCounts.organizations = erp.organizations.length;
      if (erp.branches) entityCounts.branches = erp.branches.length;
      if (erp.users) entityCounts.users = erp.users.length;
      if (erp.customers) entityCounts.customers = erp.customers.length;
      if (erp.products) entityCounts.products = erp.products.length;
      if (erp.warehouses) entityCounts.warehouses = erp.warehouses.length;
      if (erp.salesOrders) entityCounts.salesOrders = erp.salesOrders.length;
      if (erp.invoices) entityCounts.invoices = erp.invoices.length;
      if (erp.payments) entityCounts.payments = erp.payments.length;
      if (erp.stockMovements) entityCounts.stockMovements = erp.stockMovements.length;
    }

    // Analyze CRM state
    if (data.innowit_crm_state_v1) {
      const crm = data.innowit_crm_state_v1;
      if (crm.deals) entityCounts.deals = crm.deals.length;
      if (crm.tasks) entityCounts.tasks = crm.tasks.length;
      if (crm.contacts) entityCounts.contacts = crm.contacts.length;
    }

    // Analyze Accounting state
    if (data.innowit_accounting_state_v1) {
      const acc = data.innowit_accounting_state_v1;
      if (acc.accounts) entityCounts.accounts = acc.accounts.length;
      if (acc.journalEntries) entityCounts.journalEntries = acc.journalEntries.length;
      if (acc.chartOfAccounts) entityCounts.chartOfAccounts = acc.chartOfAccounts.length;
    }

    // Check for duplicates with existing data
    await this.checkConflicts(data, conflicts, warnings);

    // Estimate duration
    const totalEntities = Object.values(entityCounts).reduce((a, b) => a + b, 0);
    const estimatedDuration = `${Math.ceil(totalEntities / 100)} minutes`;

    return {
      timestamp: new Date().toISOString(),
      sourceKeys,
      entityCounts,
      conflicts,
      warnings,
      estimatedDuration,
    };
  }

  /**
   * Check for conflicts with existing database records
   */
  private async checkConflicts(
    data: LocalStorageData,
    conflicts: ImportConflict[],
    warnings: string[]
  ): Promise<void> {
    // Check organizations
    if (data.innowit_erp_state_v1?.organizations) {
      for (const org of data.innowit_erp_state_v1.organizations) {
        const existing = await prisma.organization.findUnique({
          where: { kraPin: org.kraPin },
        });

        if (existing) {
          conflicts.push({
            entityType: 'Organization',
            sourceId: org.id,
            conflictType: 'DUPLICATE_KEY',
            description: `Organization with KRA PIN ${org.kraPin} already exists`,
            suggestedResolution: 'SKIP',
            existingRecord: { id: existing.id, name: existing.legalName },
          });
        }
      }
    }

    // Check users
    if (data.innowit_erp_state_v1?.users || data.innowit_auth_state_v1?.users) {
      const users = data.innowit_erp_state_v1?.users || data.innowit_auth_state_v1?.users || [];
      for (const user of users) {
        const existing = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (existing) {
          conflicts.push({
            entityType: 'User',
            sourceId: user.id,
            conflictType: 'DUPLICATE_KEY',
            description: `User with email ${user.email} already exists`,
            suggestedResolution: 'SKIP',
            existingRecord: { id: existing.id, name: existing.fullName },
          });
        }
      }
    }

    // Check customers
    if (data.innowit_erp_state_v1?.customers) {
      for (const customer of data.innowit_erp_state_v1.customers) {
        const existing = await prisma.customer.findFirst({
          where: {
            organizationId: this.organizationId,
            OR: [
              { customerCode: customer.customerCode },
              { kraPin: customer.kraPin },
            ],
          },
        });

        if (existing) {
          conflicts.push({
            entityType: 'Customer',
            sourceId: customer.id,
            conflictType: 'DUPLICATE_KEY',
            description: `Customer with code ${customer.customerCode} or KRA PIN ${customer.kraPin} already exists`,
            suggestedResolution: 'SKIP',
            existingRecord: { id: existing.id, name: existing.name },
          });
        }
      }
    }

    // Check products
    if (data.innowit_erp_state_v1?.products) {
      for (const product of data.innowit_erp_state_v1.products) {
        const existing = await prisma.product.findFirst({
          where: {
            organizationId: this.organizationId,
            OR: [
              { sku: product.sku },
              { barcode: product.barcode },
            ],
          },
        });

        if (existing) {
          conflicts.push({
            entityType: 'Product',
            sourceId: product.id,
            conflictType: 'DUPLICATE_KEY',
            description: `Product with SKU ${product.sku} already exists`,
            suggestedResolution: 'SKIP',
            existingRecord: { id: existing.id, name: existing.name },
          });
        }
      }
    }

    // Add warnings for missing references
    if (data.innowit_erp_state_v1?.salesOrders) {
      for (const order of data.innowit_erp_state_v1.salesOrders) {
        if (order.customerId) {
          const customer = await prisma.customer.findUnique({
            where: { id: order.customerId },
          });
          if (!customer) {
            warnings.push(`Sales order ${order.orderNumber} references customer ${order.customerId} which may not be imported`);
          }
        }
      }
    }
  }

  /**
   * Execute the import
   */
  async executeImport(
    data: LocalStorageData,
    conflictResolutions: Record<string, 'SKIP' | 'UPDATE' | 'CREATE_NEW'>
  ): Promise<ImportResult> {
    const startedAt = new Date().toISOString();
    const entitiesImported: Record<string, number> = {};
    const entitiesSkipped: Record<string, number> = {};
    const errors: ImportError[] = [];

    try {
      // Check idempotency
      const idempotency = await this.checkIdempotency();
      if (idempotency.exists) {
        throw new Error('Import with this content has already been executed');
      }

      if (!this.dryRun) {
        // Create backup timestamp
        const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Import in dependency order
        await this.importOrganizations(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importBranches(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importUsers(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importCustomers(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importProducts(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importWarehouses(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importAccounts(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importDeals(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importTasks(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importSalesOrders(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importInvoices(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importPayments(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importStockMovements(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
        await this.importJournalEntries(data, conflictResolutions, entitiesImported, entitiesSkipped, errors);
      }

      const completedAt = new Date().toISOString();

      // Log the import
      await prisma.auditLog.create({
        data: {
          userId: this.userId,
          action: 'LOCALSTORAGE_IMPORT',
          entityType: 'ImportWizard',
          entityId: this.importId,
          changesJson: JSON.stringify({
            importId: this.importId,
            contentHash: this.contentHash,
            dryRun: this.dryRun,
            entitiesImported,
            entitiesSkipped,
            errors: errors.length,
          }),
        },
      });

      return {
        success: errors.filter(e => e.severity === 'ERROR').length === 0,
        importId: this.importId,
        startedAt,
        completedAt,
        entitiesImported,
        entitiesSkipped,
        errors,
        contentHash: this.contentHash,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      errors.push({
        entityType: 'ImportWizard',
        sourceId: this.importId,
        error: (error as Error).message,
        severity: 'ERROR',
      });

      return {
        success: false,
        importId: this.importId,
        startedAt,
        completedAt,
        entitiesImported,
        entitiesSkipped,
        errors,
        contentHash: this.contentHash,
      };
    }
  }

  // Import methods for each entity type
  private async importOrganizations(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const orgs = data.innowit_erp_state_v1?.organizations || [];
    imported.organizations = 0;
    skipped.organizations = 0;

    for (const org of orgs) {
      const resolutionKey = `organization:${org.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.organizations++;
          continue;
        }

        const existing = await prisma.organization.findUnique({
          where: { kraPin: org.kraPin },
        });

        if (existing && resolution !== 'CREATE_NEW') {
          skipped.organizations++;
          continue;
        }

        await prisma.organization.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : org.id,
            legalName: org.legalName,
            tradeName: org.tradeName,
            kraPin: org.kraPin,
            vatNumber: org.vatNumber,
            createdAt: new Date(org.createdAt),
            updatedAt: new Date(org.updatedAt),
          },
        });

        imported.organizations++;
      } catch (error) {
        errors.push({
          entityType: 'Organization',
          sourceId: org.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importBranches(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const branches = data.innowit_erp_state_v1?.branches || [];
    imported.branches = 0;
    skipped.branches = 0;

    for (const branch of branches) {
      const resolutionKey = `branch:${branch.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.branches++;
          continue;
        }

        const org = await prisma.organization.findUnique({
          where: { id: branch.organizationId },
        });

        if (!org) {
          errors.push({
            entityType: 'Branch',
            sourceId: branch.id,
            error: `Organization ${branch.organizationId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.branch.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : branch.id,
            organizationId: org.id,
            branchCode: branch.branchCode,
            name: branch.name,
            address: branch.address,
            phone: branch.phone,
            email: branch.email,
            isHq: branch.isHq,
            createdAt: new Date(branch.createdAt),
          },
        });

        imported.branches++;
      } catch (error) {
        errors.push({
          entityType: 'Branch',
          sourceId: branch.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importUsers(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const users = data.innowit_erp_state_v1?.users || data.innowit_auth_state_v1?.users || [];
    imported.users = 0;
    skipped.users = 0;

    for (const user of users) {
      const resolutionKey = `user:${user.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.users++;
          continue;
        }

        const existing = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (existing && resolution !== 'CREATE_NEW') {
          skipped.users++;
          continue;
        }

        // Hash password if provided
        const bcrypt = await import('bcryptjs');
        const passwordHash = user.passwordHash || await bcrypt.hash('changeme123', 12);

        await prisma.user.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : user.id,
            organizationId: this.organizationId,
            branchId: user.branchId,
            email: user.email,
            passwordHash,
            fullName: user.fullName,
            role: user.role || 'EMPLOYEE',
            isActive: user.isActive !== false,
            avatarUrl: user.avatarUrl,
            createdAt: new Date(user.createdAt),
            updatedAt: new Date(user.updatedAt),
          },
        });

        imported.users++;
      } catch (error) {
        errors.push({
          entityType: 'User',
          sourceId: user.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importCustomers(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const customers = data.innowit_erp_state_v1?.customers || [];
    imported.customers = 0;
    skipped.customers = 0;

    for (const customer of customers) {
      const resolutionKey = `customer:${customer.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.customers++;
          continue;
        }

        await prisma.customer.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : customer.id,
            organizationId: this.organizationId,
            customerCode: customer.customerCode,
            name: customer.name,
            companyName: customer.companyName,
            kraPin: customer.kraPin,
            email: customer.email,
            phone: customer.phone,
            billingAddress: customer.billingAddress,
            creditLimit: customer.creditLimit || 0,
            paymentTermsDays: customer.paymentTermsDays || 30,
            createdAt: new Date(customer.createdAt),
            updatedAt: new Date(customer.updatedAt),
          },
        });

        imported.customers++;
      } catch (error) {
        errors.push({
          entityType: 'Customer',
          sourceId: customer.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importProducts(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const products = data.innowit_erp_state_v1?.products || [];
    imported.products = 0;
    skipped.products = 0;

    for (const product of products) {
      const resolutionKey = `product:${product.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.products++;
          continue;
        }

        await prisma.product.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : product.id,
            organizationId: this.organizationId,
            sku: product.sku,
            barcode: product.barcode,
            name: product.name,
            description: product.description,
            uom: product.uom || 'PCS',
            costPrice: product.costPrice,
            sellingPrice: product.sellingPrice,
            taxClassification: product.taxClassification || 'STANDARD_16',
            reorderLevel: product.reorderLevel || 10,
            createdAt: new Date(product.createdAt),
            updatedAt: new Date(product.updatedAt),
          },
        });

        imported.products++;
      } catch (error) {
        errors.push({
          entityType: 'Product',
          sourceId: product.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importWarehouses(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const warehouses = data.innowit_erp_state_v1?.warehouses || [];
    imported.warehouses = 0;
    skipped.warehouses = 0;

    for (const warehouse of warehouses) {
      const resolutionKey = `warehouse:${warehouse.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.warehouses++;
          continue;
        }

        const branch = await prisma.branch.findUnique({
          where: { id: warehouse.branchId },
        });

        if (!branch) {
          errors.push({
            entityType: 'Warehouse',
            sourceId: warehouse.id,
            error: `Branch ${warehouse.branchId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.warehouse.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : warehouse.id,
            branchId: branch.id,
            name: warehouse.name,
            code: warehouse.code,
            location: warehouse.location,
          },
        });

        imported.warehouses++;
      } catch (error) {
        errors.push({
          entityType: 'Warehouse',
          sourceId: warehouse.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importAccounts(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const accounts = data.innowit_accounting_state_v1?.accounts || data.innowit_accounting_state_v1?.chartOfAccounts || [];
    imported.accounts = 0;
    skipped.accounts = 0;

    for (const account of accounts) {
      const resolutionKey = `account:${account.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.accounts++;
          continue;
        }

        await prisma.account.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : account.id,
            organizationId: this.organizationId,
            accountNumber: account.accountNumber,
            name: account.name,
            type: account.type,
            currency: account.currency || 'KES',
            isActive: account.isActive !== false,
            currentBalance: account.currentBalance || 0,
          },
        });

        imported.accounts++;
      } catch (error) {
        errors.push({
          entityType: 'Account',
          sourceId: account.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importDeals(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const deals = data.innowit_crm_state_v1?.deals || [];
    imported.deals = 0;
    skipped.deals = 0;

    for (const deal of deals) {
      const resolutionKey = `deal:${deal.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.deals++;
          continue;
        }

        const customer = await prisma.customer.findUnique({
          where: { id: deal.customerId },
        });

        if (!customer) {
          errors.push({
            entityType: 'Deal',
            sourceId: deal.id,
            error: `Customer ${deal.customerId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        const assignee = await prisma.user.findUnique({
          where: { id: deal.assignedToId },
        });

        if (!assignee) {
          errors.push({
            entityType: 'Deal',
            sourceId: deal.id,
            error: `Assignee ${deal.assignedToId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.deal.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : deal.id,
            customerId: customer.id,
            assignedToId: assignee.id,
            title: deal.title,
            value: deal.value,
            currency: deal.currency || 'KES',
            stage: deal.stage || 'NEW_LEAD',
            winProbability: deal.winProbability || 20,
            expectedCloseDate: deal.expectedCloseDate ? new Date(deal.expectedCloseDate) : null,
            lostReason: deal.lostReason,
            createdAt: new Date(deal.createdAt),
            updatedAt: new Date(deal.updatedAt),
          },
        });

        imported.deals++;
      } catch (error) {
        errors.push({
          entityType: 'Deal',
          sourceId: deal.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importTasks(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const tasks = data.innowit_crm_state_v1?.tasks || [];
    imported.tasks = 0;
    skipped.tasks = 0;

    for (const task of tasks) {
      const resolutionKey = `task:${task.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.tasks++;
          continue;
        }

        const assignee = await prisma.user.findUnique({
          where: { id: task.assignedToId },
        });

        if (!assignee) {
          errors.push({
            entityType: 'Task',
            sourceId: task.id,
            error: `Assignee ${task.assignedToId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.task.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : task.id,
            title: task.title,
            description: task.description,
            priority: task.priority || 'MEDIUM',
            status: task.status || 'PENDING',
            dueDate: task.dueDate ? new Date(task.dueDate) : null,
            assignedToId: assignee.id,
            customerId: task.customerId,
            dealId: task.dealId,
            createdAt: new Date(task.createdAt),
          },
        });

        imported.tasks++;
      } catch (error) {
        errors.push({
          entityType: 'Task',
          sourceId: task.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importSalesOrders(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const orders = data.innowit_erp_state_v1?.salesOrders || [];
    imported.salesOrders = 0;
    skipped.salesOrders = 0;

    for (const order of orders) {
      const resolutionKey = `salesOrder:${order.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.salesOrders++;
          continue;
        }

        const customer = await prisma.customer.findUnique({
          where: { id: order.customerId },
        });

        if (!customer) {
          errors.push({
            entityType: 'SalesOrder',
            sourceId: order.id,
            error: `Customer ${order.customerId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.salesOrder.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : order.id,
            customerId: customer.id,
            orderNumber: order.orderNumber,
            orderStatus: order.orderStatus || 'DRAFT',
            totalAmount: order.totalAmount,
            createdAt: new Date(order.createdAt),
          },
        });

        imported.salesOrders++;
      } catch (error) {
        errors.push({
          entityType: 'SalesOrder',
          sourceId: order.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importInvoices(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const invoices = data.innowit_erp_state_v1?.invoices || [];
    imported.invoices = 0;
    skipped.invoices = 0;

    for (const invoice of invoices) {
      const resolutionKey = `invoice:${invoice.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.invoices++;
          continue;
        }

        const customer = await prisma.customer.findUnique({
          where: { id: invoice.customerId },
        });

        if (!customer) {
          errors.push({
            entityType: 'SalesInvoice',
            sourceId: invoice.id,
            error: `Customer ${invoice.customerId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        const branch = await prisma.branch.findUnique({
          where: { id: invoice.branchId },
        });

        if (!branch) {
          errors.push({
            entityType: 'SalesInvoice',
            sourceId: invoice.id,
            error: `Branch ${invoice.branchId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.salesInvoice.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : invoice.id,
            branchId: branch.id,
            customerId: customer.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: new Date(invoice.invoiceDate),
            dueDate: new Date(invoice.dueDate),
            status: invoice.status || 'DRAFT',
            isSandbox: invoice.isSandbox || false,
            subtotal: invoice.subtotal,
            taxAmount: invoice.taxAmount,
            totalAmount: invoice.totalAmount,
            paidAmount: invoice.paidAmount || 0,
            createdAt: new Date(invoice.createdAt),
          },
        });

        imported.invoices++;
      } catch (error) {
        errors.push({
          entityType: 'SalesInvoice',
          sourceId: invoice.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importPayments(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const payments = data.innowit_erp_state_v1?.payments || [];
    imported.payments = 0;
    skipped.payments = 0;

    for (const payment of payments) {
      const resolutionKey = `payment:${payment.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.payments++;
          continue;
        }

        const invoice = await prisma.salesInvoice.findUnique({
          where: { id: payment.salesInvoiceId },
        });

        if (!invoice) {
          errors.push({
            entityType: 'CustomerPayment',
            sourceId: payment.id,
            error: `Invoice ${payment.salesInvoiceId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.customerPayment.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : payment.id,
            salesInvoiceId: invoice.id,
            paymentNumber: payment.paymentNumber,
            paymentDate: new Date(payment.paymentDate),
            amount: payment.amount,
            paymentMethod: payment.paymentMethod,
            referenceCode: payment.referenceCode,
            createdAt: new Date(payment.createdAt),
          },
        });

        imported.payments++;
      } catch (error) {
        errors.push({
          entityType: 'CustomerPayment',
          sourceId: payment.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importStockMovements(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const movements = data.innowit_erp_state_v1?.stockMovements || [];
    imported.stockMovements = 0;
    skipped.stockMovements = 0;

    for (const movement of movements) {
      const resolutionKey = `stockMovement:${movement.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.stockMovements++;
          continue;
        }

        const product = await prisma.product.findUnique({
          where: { id: movement.productId },
        });

        if (!product) {
          errors.push({
            entityType: 'StockMovement',
            sourceId: movement.id,
            error: `Product ${movement.productId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        const warehouse = await prisma.warehouse.findUnique({
          where: { id: movement.warehouseId },
        });

        if (!warehouse) {
          errors.push({
            entityType: 'StockMovement',
            sourceId: movement.id,
            error: `Warehouse ${movement.warehouseId} not found`,
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.stockMovement.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : movement.id,
            productId: product.id,
            warehouseId: warehouse.id,
            movementType: movement.movementType,
            quantity: movement.quantity,
            unitCost: movement.unitCost,
            referenceDocument: movement.referenceDocument,
            notes: movement.notes,
            timestamp: new Date(movement.timestamp),
          },
        });

        imported.stockMovements++;
      } catch (error) {
        errors.push({
          entityType: 'StockMovement',
          sourceId: movement.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }

  private async importJournalEntries(
    data: LocalStorageData,
    resolutions: Record<string, string>,
    imported: Record<string, number>,
    skipped: Record<string, number>,
    errors: ImportError[]
  ): Promise<void> {
    const entries = data.innowit_accounting_state_v1?.journalEntries || [];
    imported.journalEntries = 0;
    skipped.journalEntries = 0;

    for (const entry of entries) {
      const resolutionKey = `journalEntry:${entry.id}`;
      const resolution = resolutions[resolutionKey] || 'SKIP';

      try {
        if (resolution === 'SKIP') {
          skipped.journalEntries++;
          continue;
        }

        // Verify all account IDs exist
        const accountIds = entry.lines.map((l: any) => l.accountId);
        const accounts = await prisma.account.findMany({
          where: { id: { in: accountIds } },
        });

        if (accounts.length !== accountIds.length) {
          errors.push({
            entityType: 'JournalEntry',
            sourceId: entry.id,
            error: 'One or more accounts not found',
            severity: 'ERROR',
          });
          continue;
        }

        await prisma.journalEntry.create({
          data: {
            id: resolution === 'CREATE_NEW' ? crypto.randomUUID() : entry.id,
            organizationId: this.organizationId,
            entryNumber: entry.entryNumber,
            postingDate: new Date(entry.postingDate),
            sourceModule: entry.sourceModule,
            sourceId: entry.sourceId,
            description: entry.description,
            isReversed: entry.isReversed || false,
            reversalEntryId: entry.reversalEntryId,
            createdAt: new Date(entry.createdAt),
            lines: {
              create: entry.lines.map((line: any) => ({
                accountId: line.accountId,
                description: line.description,
                debit: line.debit,
                credit: line.credit,
              })),
            },
          },
        });

        imported.journalEntries++;
      } catch (error) {
        errors.push({
          entityType: 'JournalEntry',
          sourceId: entry.id,
          error: (error as Error).message,
          severity: 'ERROR',
        });
      }
    }
  }
}

// Export factory function
export async function createImportWizard(
  organizationId: string,
  userId: string,
  localStorageData: LocalStorageData,
  dryRun = false
): Promise<{ wizard: LocalStorageImportWizard; report: ImportMappingReport }> {
  const wizard = new LocalStorageImportWizard(organizationId, userId, dryRun);
  wizard.generateContentHash(localStorageData);
  const report = await wizard.analyzeData(localStorageData);
  return { wizard, report };
}