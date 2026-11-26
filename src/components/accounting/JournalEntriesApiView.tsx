/**
 * Phase 4 — API-wired Journal Entries
 * Fetches journals and accounts from live API; wraps JournalEntriesView.
 * Eliminates DEFAULT_JOURNAL_ENTRIES and DEFAULT_ACCOUNTS static props from App.tsx.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { JournalEntriesView } from '@/components/views/JournalEntriesView';
import { apiClient } from '@/services/api/apiClient';
import { JournalEntry, JournalLine, Account, AccountType, UserRole } from '@/types';

interface JournalEntriesApiViewProps {
  userRole: UserRole;
  userFullName: string;
}

export function JournalEntriesApiView({ userRole, userFullName }: JournalEntriesApiViewProps) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [journalsRes, accountsRes] = await Promise.all([
        apiClient.getJournals({ limit: 200 }),
        apiClient.getAccounts({ limit: 500 }),
      ]);

      // Map journals to frontend JournalEntry type
      const jRaw = (journalsRes as any)?.data ?? journalsRes;
      const jList: any[] = Array.isArray(jRaw?.data) ? jRaw.data : Array.isArray(jRaw) ? jRaw : [];
      const mappedEntries: JournalEntry[] = jList.map((j: any): JournalEntry => ({
        id: j.id,
        entryNumber: j.reference ?? j.id.slice(0, 8).toUpperCase(),
        date: (j.postingDate ?? j.date ?? '').slice(0, 10),
        reference: j.reference ?? j.id.slice(0, 8).toUpperCase(),
        memo: j.description ?? '',
        postedBy: j.postedBy ?? j.createdBy ?? 'system',
        createdBy: j.createdBy,
        status: (j.status === 'REVERSED' ? 'VOID' : j.status) as 'DRAFT' | 'POSTED' | 'VOID',
        lines: (j.lines ?? []).map((l: any): JournalLine => ({
          id: l.id,
          accountId: l.accountId,
          accountNumber: l.account?.code ?? '',
          accountName: l.account?.name ?? '',
          description: l.description ?? '',
          debit: Number(l.debit ?? 0),
          credit: Number(l.credit ?? 0),
        })),
        totalDebit: (j.lines ?? []).reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0),
        totalCredit: (j.lines ?? []).reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0),
        isReversed: j.isReversed ?? false,
        reversalEntryId: j.reversalEntryId,
        sourceModule: j.sourceModule,
        sourceId: j.sourceId,
        postedAt: j.postedAt,
      }));
      setEntries(mappedEntries);

      // Map accounts
      const aRaw = (accountsRes as any)?.data ?? accountsRes;
      const aList: any[] = Array.isArray(aRaw?.data) ? aRaw.data : Array.isArray(aRaw) ? aRaw : [];
      const mappedAccounts: Account[] = aList.map((a: any): Account => ({
        id: a.id,
        organizationId: a.organizationId ?? '',
        accountNumber: a.code ?? a.accountNumber ?? '',
        name: a.name,
        type: (a.type as AccountType) ?? 'ASSET',
        subType: a.subType ?? '',
        balance: Number(a.openingBalance ?? a.balance ?? 0),
        description: a.description ?? '',
        currency: a.currency ?? 'KES',
        isActive: a.isActive !== false,
      }));
      setAccounts(mappedAccounts);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load journal data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddEntry = useCallback(async (newEntry: JournalEntry) => {
    try {
      await apiClient.createJournal({
        postingDate: newEntry.date,
        description: newEntry.memo,
        lines: newEntry.lines.map((l) => ({
          accountId: l.accountId,
          debit: String(l.debit),
          credit: String(l.credit),
          description: l.description,
        })),
      });
      await fetchData();
    } catch (err: any) {
      console.error('[JournalEntriesApiView] createJournal failed:', err?.message);
    }
  }, [fetchData]);

  const handleReverseEntry = useCallback(async (originalEntryId: string, _reversingEntry: JournalEntry) => {
    try {
      await apiClient.reverseJournal(originalEntryId, {
        reason: 'Manual reversal from journal entries view',
      });
      await fetchData();
    } catch (err: any) {
      console.error('[JournalEntriesApiView] reverseJournal failed:', err?.message);
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
    <JournalEntriesView
      entries={entries}
      accounts={accounts}
      onAddEntry={handleAddEntry}
      onReverseEntry={handleReverseEntry}
      userRole={userRole}
      userFullName={userFullName}
    />
  );
}
