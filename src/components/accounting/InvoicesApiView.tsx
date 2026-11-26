/**
 * Phase 4 — API-wired Sales Invoices
 * Wraps InvoicesView, fetching live data from /api/accounting/invoices.
 * Eliminates SEED_INVOICES and static customer/product data from App.tsx.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { InvoicesView } from '@/components/accounting/InvoicesView';
import { apiClient } from '@/services/api/apiClient';
import {
  InvoiceRecord,
  InvoiceLineItem,
  CustomerRecord,
  ProductRecord,
  PaymentRecord,
  UserRole,
} from '@/types';

interface InvoicesApiViewProps {
  userRole: UserRole;
  userFullName: string;
}

/** Map a server invoice object to the frontend InvoiceRecord shape */
function mapInvoice(inv: any): InvoiceRecord {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? inv.id.slice(0, 8).toUpperCase(),
    customerId: inv.customerId ?? '',
    customerName: inv.customer?.name ?? inv.customerName ?? '',
    customerPin: inv.customer?.taxPin ?? inv.customerPin ?? '',
    customerAddress: inv.customer?.billingAddress ?? '',
    issueDate: (inv.invoiceDate ?? inv.issueDate ?? inv.createdAt ?? '').slice(0, 10),
    dueDate: (inv.dueDate ?? '').slice(0, 10),
    paymentTermsDays: inv.paymentTermsDays ?? 30,
    status: inv.status as InvoiceRecord['status'],
    items: (inv.lines ?? inv.items ?? []).map((l: any): InvoiceLineItem => ({
      id: l.id,
      productId: l.productId ?? '',
      productName: l.product?.name ?? l.description ?? '',
      description: l.description ?? '',
      quantity: Number(l.quantity ?? 1),
      unitPrice: Number(l.unitPrice ?? 0),
      taxRate: Number(l.taxRate ?? 0),
      taxClassification: (l.taxClassification ?? 'STANDARD_16') as InvoiceLineItem['taxClassification'],
      taxAmount: Number(l.taxAmount ?? 0),
      lineTotal: Number(l.lineTotal ?? l.amount ?? 0),
    })),
    subtotal: Number(inv.subtotal ?? inv.totalAmount ?? 0),
    taxableAmount: Number(inv.taxableAmount ?? 0),
    taxAmount: Number(inv.taxAmount ?? 0),
    totalAmount: Number(inv.totalAmount ?? 0),
    paidAmount: Number(inv.paidAmount ?? 0),
    balanceDue: Number(inv.balanceDue ?? inv.totalAmount ?? 0),
    kraControlNumber: inv.kraControlNumber ?? undefined,
    kraQrPayload: inv.kraQrPayload ?? undefined,
    payments: (inv.payments ?? []).map((p: any): PaymentRecord => ({
      id: p.id,
      invoiceId: inv.id,
      invoiceNumber: p.invoiceNumber ?? inv.invoiceNumber,
      customerName: p.customerName ?? inv.customerName,
      paymentNumber: p.paymentNumber ?? p.id.slice(0, 8).toUpperCase(),
      date: (p.paymentDate ?? p.date ?? p.createdAt ?? '').slice(0, 10),
      paymentDate: (p.paymentDate ?? p.date ?? '').slice(0, 10),
      amount: Number(p.amount ?? 0),
      paymentMethod: (p.method ?? p.paymentMethod ?? 'BANK_TRANSFER') as PaymentRecord['paymentMethod'],
      referenceCode: p.reference ?? p.referenceCode ?? '',
      referenceNumber: p.referenceNumber,
      recordedBy: p.recordedBy ?? p.createdBy ?? 'system',
      notes: p.notes ?? '',
    })),
    createdAt: inv.createdAt ?? '',
  };
}

export function InvoicesApiView({ userRole, userFullName }: InvoicesApiViewProps) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [products] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [invRes, custRes] = await Promise.all([
        apiClient.getInvoices({ limit: 200 }),
        apiClient.getCustomers({ limit: 500 }),
      ]);

      const invRaw = (invRes as any)?.data ?? invRes;
      const invList: any[] = Array.isArray(invRaw?.data) ? invRaw.data : Array.isArray(invRaw) ? invRaw : [];
      setInvoices(invList.map(mapInvoice));

      const custRaw = (custRes as any)?.data ?? custRes;
      const custList: any[] = Array.isArray(custRaw?.data) ? custRaw.data : Array.isArray(custRaw) ? custRaw : [];
      const mappedCustomers: CustomerRecord[] = custList.map((c: any): CustomerRecord => ({
        id: c.id,
        customerCode: c.customerCode ?? c.code,
        name: c.name,
        companyName: c.companyName ?? c.name,
        kraPin: c.taxPin ?? c.kraPin ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        city: c.city ?? '',
        billingAddress: c.address ?? c.billingAddress,
        creditLimitKes: Number(c.creditLimit ?? 0),
        paymentTermsDays: c.paymentTermsDays ?? 30,
        totalRevenueKes: Number(c.totalRevenueKes ?? 0),
        outstandingBalanceKes: Number(c.outstandingBalance ?? c.outstandingBalanceKes ?? 0),
        status: (c.isActive !== false ? 'ACTIVE' : 'INACTIVE') as CustomerRecord['status'],
        lifecycle: c.lifecycle,
        businessType: c.businessType,
        leadSource: c.leadSource,
        createdAt: c.createdAt ?? '',
      }));
      setCustomers(mappedCustomers);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load invoice data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateInvoice = useCallback(async (invoice: InvoiceRecord) => {
    try {
      const created = await apiClient.createInvoice({
        customerId: invoice.customerId,
        invoiceDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: 'KES',
        lines: (invoice.items ?? []).map((l: InvoiceLineItem) => ({
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
        })),
      });
      const newId = (created as any)?.data?.id ?? (created as any)?.id;
      if (newId) {
        await apiClient.postInvoice(newId);
      }
      await fetchData();
    } catch (err: any) {
      console.error('[InvoicesApiView] createInvoice failed:', err?.message);
    }
  }, [fetchData]);

  const handleRecordPayment = useCallback(async (
    invoiceId: string,
    payment: PaymentRecord,
    _isFullSettlement: boolean
  ) => {
    try {
      await apiClient.createCustomerPayment({
        invoiceId,
        amount: payment.amount,
        paymentDate: payment.date,
        method: payment.paymentMethod,
        reference: payment.referenceCode,
        notes: payment.notes,
      });
      await fetchData();
    } catch (err: any) {
      console.error('[InvoicesApiView] createCustomerPayment failed:', err?.message);
    }
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#00B3C8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button onClick={fetchData} className="text-xs text-[#00B3C8] underline">Retry</button>
      </div>
    );
  }

  return (
    <InvoicesView
      invoices={invoices}
      customers={customers}
      products={products}
      onCreateInvoice={handleCreateInvoice}
      onRecordPayment={handleRecordPayment}
      userRole={userRole}
      userFullName={userFullName}
    />
  );
}
