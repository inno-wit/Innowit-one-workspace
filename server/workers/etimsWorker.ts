import { prisma } from '../prisma';
import { decrypt } from '../utils/encryption';
import { EtimsSubmissionStatus } from '@prisma/client';

// eTIMS Background Worker
// Processes the transmission queue and submits invoices to KRA eTIMS

interface EtimsPayload {
  invoiceId: string;
  type?: 'INVOICE' | 'CREDIT_NOTE';
}

class EtimsWorker {
  private isRunning = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30000; // 30 seconds
  private readonly MAX_ATTEMPTS = 5;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('eTIMS worker already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting eTIMS background worker...');

    // Run immediately on start
    await this.processQueue();

    // Then poll at interval
    this.interval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('eTIMS worker error:', error);
      }
    }, this.POLL_INTERVAL);
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('eTIMS worker stopped');
  }

  private async processQueue(): Promise<void> {
    const now = new Date();

    // Get pending items ready for processing
    const queueItems = await prisma.etimsTransmissionQueue.findMany({
      where: {
        status: { in: ['PENDING', 'RETRY_SCHEDULED'] as EtimsSubmissionStatus[] },
        nextRetryAt: { lte: now },
        attemptCount: { lt: this.MAX_ATTEMPTS },
      },
      include: {
        salesInvoice: {
          include: {
            customer: true,
            branch: true,
            items: { include: { product: true } },
            etimsInvoice: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10, // Process in batches
    });

    if (queueItems.length === 0) {
      return;
    }

    console.log(`Processing ${queueItems.length} eTIMS queue items`);

    for (const item of queueItems) {
      await this.processQueueItem(item);
    }
  }

  private async processQueueItem(item: any): Promise<void> {
    const { id, salesInvoice, attemptCount, payloadJson } = item;

    try {
      // Update status to IN_FLIGHT
      await prisma.etimsTransmissionQueue.update({
        where: { id },
        data: { status: 'IN_FLIGHT', attemptCount: { increment: 1 } },
      });

      // Get eTIMS configuration
      const config = await prisma.etimsConfiguration.findFirst({
        where: {
          organizationId: salesInvoice.customer.organizationId,
          environment: salesInvoice.isSandbox ? 'SANDBOX' : 'PRODUCTION',
        },
      });

      if (!config) {
        throw new Error('No eTIMS configuration found for organization');
      }

      const clientSecret = decrypt(config.clientSecretEnc);

      // Build eTIMS payload based on type
      const payload = JSON.parse(payloadJson);
      const etimsPayload = this.buildEtimsPayload(salesInvoice, payload.type || 'INVOICE', config);

      // Submit to eTIMS
      const response = await this.submitToEtims(config.apiUrl, clientSecret, etimsPayload);

      if (response.success) {
        // Success - create EtimsInvoice record (audit fix ETIMS-3: check for
        // existing EtimsInvoice first so retries never duplicate the record)
        await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
          const existingEtimsInvoice = await tx.etimsInvoice.findUnique({
            where: { salesInvoiceId: salesInvoice.id },
          });
          if (!existingEtimsInvoice) {
            await tx.etimsInvoice.create({
              data: {
                salesInvoiceId: salesInvoice.id,
                kraControlNumber: response.controlNumber,
                internalData: response.internalData,
                qrCodeUrl: response.qrCodeUrl,
                submissionDate: new Date(),
                ackCode: response.ackCode || '00',
              },
            });
          }

          await tx.etimsTransmissionQueue.update({
            where: { id },
            data: {
              status: 'ACCEPTED',
              responseJson: JSON.stringify(response),
            },
          });

          // Update invoice status if it was just posted
          if (salesInvoice.status === 'POSTED') {
            await tx.salesInvoice.update({
              where: { id: salesInvoice.id },
              data: { status: 'POSTED' }, // Keep as POSTED, eTIMS info is in etimsInvoice
            });
          }
        });

        console.log(`eTIMS submission successful for invoice ${salesInvoice.invoiceNumber}: ${response.controlNumber}`);
      } else {
        // Failed - schedule retry
        await this.scheduleRetry(item, response.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`eTIMS submission failed for queue item ${id}:`, error);
      await this.scheduleRetry(item, (error as Error).message);
    }
  }

  private buildEtimsPayload(invoice: any, type: 'INVOICE' | 'CREDIT_NOTE', config: any): any {
    const items = invoice.items.map((item: any) => ({
      itemCode: item.product.sku,
      itemName: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate: item.taxClassification === 'STANDARD_16' ? 16 : 
               item.taxClassification === 'ZERO_RATED' ? 0 : 
               item.taxClassification === 'EXEMPT' ? 0 : 5,
      taxAmount: Number(item.taxAmount),
      totalAmount: Number(item.lineTotal),
    }));

    const payload: any = {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString().split('T')[0],
      invoiceTime: invoice.invoiceDate.toISOString().split('T')[1].substring(0, 5),
      customerPin: invoice.customer.kraPin || '',
      customerName: invoice.customer.name,
      customerAddress: invoice.customer.billingAddress || '',
      branchCode: config.branchCode,
      items,
      totalAmount: Number(invoice.totalAmount),
      taxAmount: Number(invoice.taxAmount),
      currency: 'KES',
      invoiceType: type,
    };

    if (type === 'CREDIT_NOTE' && invoice.etimsInvoice) {
      payload.originalControlNumber = invoice.etimsInvoice.kraControlNumber;
    }

    return payload;
  }

  private async submitToEtims(apiUrl: string, clientSecret: string, payload: any): Promise<any> {
    // This is a simplified implementation
    // In production, you would implement the actual KRA eTIMS API integration
    // including proper authentication, request signing, etc.
    
    try {
      const response = await fetch(`${apiUrl}/invoice/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clientSecret}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      const data = await response.json() as Record<string, any>;

      if (response.ok && (data as any).ackCode === '00') {
        return {
          success: true,
          controlNumber: (data as any).controlNumber,
          internalData: (data as any).internalData,
          qrCodeUrl: (data as any).qrCodeUrl,
          ackCode: (data as any).ackCode,
        };
      } else {
        return {
          success: false,
          error: (data as any).message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async scheduleRetry(item: any, error: string): Promise<void> {
    const nextAttempt = item.attemptCount + 1;
    
    if (nextAttempt >= this.MAX_ATTEMPTS) {
      // Max attempts reached
      await prisma.etimsTransmissionQueue.update({
        where: { id: item.id },
        data: {
          status: 'RETRY_SCHEDULED',
          lastError: error,
          attemptCount: nextAttempt,
        },
      });
      console.log(`eTIMS queue item ${item.id} max attempts reached, marked for manual review`);
    } else {
      // Exponential backoff: attempt^3 * 30 seconds
      const backoffSeconds = Math.pow(nextAttempt, 3) * 30;
      const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

      await prisma.etimsTransmissionQueue.update({
        where: { id: item.id },
        data: {
          status: 'PENDING',
          lastError: error,
          attemptCount: nextAttempt,
          nextRetryAt,
        },
      });
      console.log(`eTIMS queue item ${item.id} scheduled for retry in ${backoffSeconds} seconds (attempt ${nextAttempt})`);
    }
  }
}

// Export singleton instance
export const etimsWorker = new EtimsWorker();

// Auto-start if this file is run directly
if (require.main === module) {
  etimsWorker.start().catch(console.error);
  
  process.on('SIGTERM', () => etimsWorker.stop());
  process.on('SIGINT', () => etimsWorker.stop());
}