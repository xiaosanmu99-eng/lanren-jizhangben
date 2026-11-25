"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "@/lib/client-api";
import { hasUntagged, tagColor, tagLabel, tagsInLedger } from "@/lib/categories";
import { addDays, monthRange, formatMonthDay, weekRange, weekdayLabel } from "@/lib/dates";
import { filterTransactions } from "@/lib/filter";
import { formatYuan, sumCents } from "@/lib/money";
import { parseEntry, REASON_TEXT } from "@/lib/parse";
import { renderRecapPng } from "@/lib/recap-image";
import { entryDescription } from "@/lib/record";
import type { ImportReport, SessionState, Transaction, WeekSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EntryFields, emptyFields, fieldsFromDraft, fieldsFromTransaction, payloadFromFields, type FieldValues } from "@/components/entry-fields";

type Tab = "capture" | "list" | "recap" | "backup";

const TABS: { id: Tab; label: string }[] = [
  { id: "capture", label: "记一笔" },
  { id: "list", label: "流水" },
  { id: "recap", label: "本周" },
  { id: "backup", label: "备份" },
];

export function LedgerApp() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("capture");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api<SessionState>("/api/session");
      setSession(next);
      if (next.authenticated) {
        const data = await api<{ transactions: Transaction[] }>("/api/transactions");
        setTransactions(data.transactions);
      } else {
        setTransactions(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账本没有打开");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return (
    <div className="min-h-dvh bg-[#2A211C] text-[#241910]">
      <a href="#ledger-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-xl focus:bg-card focus:px-3 focus:py-2">
        跳到内容
      </a>
      <div className="mx-auto flex h-dvh w-full max-w-[430px] flex-col bg-[#F6F0E6]">
        <header className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-[#C24B24] text-lg font-semibold text-[#FFF8F3]" aria-hidden>
              懒
            </div>
            <div>
              <p className="text-xs tracking-[0.18em] text-[#6E6256]">肖三木</p>
              <h1 className="font-seal text-[1.7rem] leading-none">懒人记账本</h1>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#6E6256]">{session?.notice ?? "正在打开这本私人账。"}</p>
        </header>
        <main id="ledger-main" className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <p className="sr-only" aria-live="polite">
            {notice}
          </p>
          {!session && !error ? <p className="text-sm text-[#6E6256]">正在核对服务器上的账本。</p> : null}
          {error ? (
            <div className="rounded-3xl bg-card p-4">
              <p className="text-base">{error}</p>
              <Button type="button" className="mt-4 h-12 rounded-2xl px-5 text-base" onClick={() => void load()}>
                再试一次
              </Button>
            </div>
          ) : null}
          {session && !session.authenticated ? <AuthPanel session={session} onReady={() => void load()} /> : null}
          {session?.authenticated && transactions ? (
            <>
              {tab === "capture" ? (
                <CapturePanel
                  today={session.today}
                  transactions={transactions}
                  onSaved={async (text) => {
                    setNotice(text);
                    await load();
                  }}
                />
              ) : null}
              {tab === "list" ? (
                <ListPanel
                  today={session.today}
                  transactions={transactions}
                  onChanged={async (text) => {
                    setNotice(text);
                    await load();
                  }}
                />
              ) : null}
              {tab === "recap" ? <RecapPanel today={session.today} /> : null}
              {tab === "backup" ? (
                <BackupPanel
                  count={transactions.length}
                  ingestionConfigured={session.ingestionConfigured}
                  onChanged={async (text) => {
                    setNotice(text);
                    await load();
                  }}
                />
              ) : null}
            </>
          ) : null}
        </main>
        {session?.authenticated ? (
          <nav className="grid shrink-0 grid-cols-4 border-t border-[#E4D5C3] bg-[#FFFBF5] pb-[env(safe-area-inset-bottom)]" aria-label="账本栏目">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? "page" : undefined}
                className={`flex h-14 items-center justify-center whitespace-nowrap px-1 text-[13px] leading-none ${tab === item.id ? "font-semibold text-[#C24B24]" : "text-[#6E6256]"}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function AuthPanel({ session, onReady }: { session: SessionState; onReady: () => void }) {
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const setup = session.setupAvailable;

  async function submit() {
    setError(null);
    if (setup && password !== repeat) {
      setError("两次登录口令不一致");
      return;
    }
    setPending(true);
    try {
      if (setup) {
        await api("/api/setup", {
          method: "POST",
          body: JSON.stringify({ setupToken, password }),
        });
      } else {
        await api("/api/session", { method: "POST", body: JSON.stringify({ password }) });
      }
      onReady();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有进去");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <section className="rounded-3xl bg-card p-4">
        <h2 className="font-seal text-2xl">{setup ? "先给这本账设一把口令" : "输入口令"}</h2>
        <p className="mt-2 text-sm leading-6 text-[#6E6256]">
          {setup
            ? "配置口令只在第一次建账时填写，不会放进网址。之后只用你自己的登录口令。"
            : "这本账已经有主人。口令只留在这台服务器的会话里。"}
        </p>
      </section>
      {setup ? (
        <Field label="一次性配置口令" id="setup-token">
          <Input id="setup-token" type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} className="h-12 rounded-2xl bg-card px-3 text-base" />
        </Field>
      ) : null}
      <Field label="登录口令" id="password">
        <Input
          id="password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 rounded-2xl bg-card px-3 text-base"
        />
      </Field>
      {setup ? (
        <Field label="再输入一次登录口令" id="repeat">
          <Input id="repeat" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} className="h-12 rounded-2xl bg-card px-3 text-base" />
        </Field>
      ) : null}
      {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
      {!setup && !session.ownerExists ? (
        <p className="text-sm leading-6 text-[#6E6256]">服务器还没准备好建账。需要先在托管环境里设置 LEDGER_SETUP_TOKEN，不能写进网址。</p>
      ) : null}
      <Button type="submit" disabled={pending || (!setup && !session.ownerExists)} className="h-12 rounded-2xl text-base">
        {pending ? "正在核对" : setup ? "建账并进入" : "进入账本"}
      </Button>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function CapturePanel({
  today,
  transactions,
  onSaved,
}: {
  today: string;
  transactions: Transaction[];
  onSaved: (message: string) => Promise<void>;
}) {
  const count = transactions.length;
  const knownTags = useMemo(() => tagsInLedger(transactions), [transactions]);
  const [mode, setMode] = useState<"sentence" | "form">("sentence");
  const [text, setText] = useState("");
  const [fields, setFields] = useState<FieldValues>(() => emptyFields(today));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const parsed = useMemo(() => parseEntry(text, today), [text, today]);
  const showFields = mode === "form" || parsed.status === "needs_confirmation" || editing;
  const activeFields = mode === "sentence" && !editing && parsed.status !== "needs_confirmation" ? fieldsFromDraft(parsed.draft, today) : fields;
  const checked = payloadFromFields(showFields ? fields : activeFields);

  async function save(body: ReturnType<typeof payloadFromFields>) {
    if (!body.ok) {
      setError(body.message);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/api/transactions", { method: "POST", body: JSON.stringify(body.body) });
      setText("");
      setFields(emptyFields(today));
      setEditing(false);
      await onSaved("已写入服务器。");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "没有写入");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="记账方式">
        <Toggle pressed={mode === "sentence"} onClick={() => setMode("sentence")}>
          一句话
        </Toggle>
        <Toggle pressed={mode === "form"} onClick={() => setMode("form")}>
          逐项填写
        </Toggle>
      </div>
      {count === 0 ? (
        <section className="rounded-3xl bg-card p-4">
          <h2 className="font-seal text-2xl">账本是空的</h2>
          <p className="mt-2 text-sm leading-6 text-[#6E6256]">花完写「买书 35」或「理发 30」。有金额和一句说明就能记下，标签可以不选。看不清金额或日期时会先让你确认。</p>
        </section>
      ) : null}
      {mode === "sentence" ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(parsed.status === "ready" && !editing ? payloadFromFields(fieldsFromDraft(parsed.draft, today)) : payloadFromFields(fields));
          }}
        >
          <Label htmlFor="sentence">吃完或花完，写在这里</Label>
          <Input
            id="sentence"
            value={text}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              setEditing(false);
              setFields(fieldsFromDraft(parseEntry(next, today).draft, today));
            }}
            className="h-12 rounded-2xl bg-card px-3 text-base"
            placeholder="例如：买书 35"
          />
          {parsed.status === "ready" && !editing ? (
            <article className="rounded-3xl bg-card p-4">
              <p className="text-sm text-[#6E6256]">将记下</p>
              <p className="num mt-1 text-2xl">{parsed.draft.refund ? "退款 " : ""}¥{formatYuan(Math.abs(parsed.draft.amountCents ?? 0))}</p>
              <p className="mt-1 text-base">{parsed.draft.merchant}</p>
              <p className="mt-1 text-sm text-[#6E6256]">
                {parsed.draft.category ? `${parsed.draft.category} · ` : ""}
                {parsed.draft.date}
              </p>
              <button type="button" className="mt-3 text-sm text-[#C24B24] underline-offset-4 hover:underline" onClick={() => setEditing(true)}>
                改一下
              </button>
            </article>
          ) : null}
          {parsed.status === "needs_confirmation" ? (
            <div className="rounded-3xl border border-[#E7C7A2] bg-[#FFF7EE] p-4 text-sm leading-6">
              <p className="font-medium">先确认再记</p>
              <ul className="mt-1 list-disc pl-5">
                {parsed.reasons.map((reason) => (
                  <li key={reason}>{REASON_TEXT[reason]}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {showFields ? <EntryFields idPrefix="capture" values={fields} knownTags={knownTags} onChange={setFields} /> : null}
          {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
          <Button type="submit" disabled={pending || (showFields ? !checked.ok : parsed.status !== "ready")} className="h-12 rounded-2xl text-base">
            {parsed.status === "needs_confirmation" || editing ? "确认后记下" : "记下这笔"}
          </Button>
        </form>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(payloadFromFields(fields));
          }}
        >
          <EntryFields idPrefix="manual" values={fields} knownTags={knownTags} onChange={setFields} />
          {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
          <Button type="submit" disabled={pending || !payloadFromFields(fields).ok} className="h-12 rounded-2xl text-base">
            记下这笔
          </Button>
        </form>
      )}
    </div>
  );
}

function ListPanel({
  today,
  transactions,
  onChanged,
}: {
  today: string;
  transactions: Transaction[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [tagFilter, setTagFilter] = useState<{ kind: "all" } | { kind: "untagged" } | { kind: "tag"; value: string }>({ kind: "all" });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [fields, setFields] = useState<FieldValues>(() => emptyFields(today));
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const knownTags = useMemo(() => tagsInLedger(transactions), [transactions]);
  const filtered = filterTransactions(transactions, {
    tag: tagFilter.kind === "tag" ? tagFilter.value : undefined,
    untagged: tagFilter.kind === "untagged",
    from,
    to,
    q,
  });
  const week = weekRange(today);
  const month = monthRange(today);

  function edit(item: Transaction) {
    setEditing(item);
    setFields(fieldsFromTransaction(item));
  }

  async function saveEdit() {
    if (!editing) return;
    const payload = payloadFromFields(fields, editing);
    if (!payload.ok) {
      setError(payload.message);
      return;
    }
    try {
      await api(`/api/transactions/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload.body) });
      setEditing(null);
      await onChanged("已改好，并写回服务器。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有改成");
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await api(`/api/transactions/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await onChanged("已从服务器删掉。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有删掉");
    }
  }

  const groups: { date: string; items: Transaction[] }[] = [];
  for (const item of filtered) {
    const last = groups.at(-1);
    if (!last || last.date !== item.date) groups.push({ date: item.date, items: [item] });
    else last.items.push(item);
  }

  return (
    <div className="grid gap-4">
      <Label htmlFor="keyword">搜索说明或标签</Label>
      <Input id="keyword" value={q} onChange={(event) => setQ(event.target.value)} className="h-12 rounded-2xl bg-card px-3 text-base" placeholder="搜索" />
      <div className="flex flex-wrap gap-2" role="group" aria-label="按标签筛选">
        <Chip pressed={tagFilter.kind === "all"} onClick={() => setTagFilter({ kind: "all" })}>全部</Chip>
        {knownTags.map((item) => (
          <Chip key={item} pressed={tagFilter.kind === "tag" && tagFilter.value === item} onClick={() => setTagFilter({ kind: "tag", value: item })}>
            {item}
          </Chip>
        ))}
        {hasUntagged(transactions) ? (
          <Chip pressed={tagFilter.kind === "untagged"} onClick={() => setTagFilter({ kind: "untagged" })}>无标签</Chip>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="按日期筛选">
        <Chip pressed={!from && !to} onClick={() => { setFrom(""); setTo(""); }}>全部日期</Chip>
        <Chip pressed={from === today && to === today} onClick={() => { setFrom(today); setTo(today); }}>今天</Chip>
        <Chip pressed={from === week.start && to === week.end} onClick={() => { setFrom(week.start); setTo(week.end); }}>本周</Chip>
        <Chip pressed={from === month.start && to === month.end} onClick={() => { setFrom(month.start); setTo(month.end); }}>本月</Chip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="开始日期" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-12 rounded-2xl bg-card px-3 text-base" />
        <Input aria-label="结束日期" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-12 rounded-2xl bg-card px-3 text-base" />
      </div>
      <p className="num text-sm text-[#6E6256]">
        筛出 {filtered.length} 笔，结余 ¥{formatYuan(sumCents(filtered.map((item) => item.amountCents)))}
      </p>
      {transactions.length === 0 ? <p className="rounded-3xl bg-card p-4 text-sm leading-6">这本账还是空的。记一笔之后，会按日期排在这里。</p> : null}
      {transactions.length > 0 && filtered.length === 0 ? <p className="rounded-3xl bg-card p-4 text-sm">没有符合条件的账。</p> : null}
      {groups.map((group) => (
        <section key={group.date} className="grid gap-2">
          <h2 className="text-sm text-[#6E6256]">
            {formatMonthDay(group.date)} {weekdayLabel(group.date)} · ¥{formatYuan(sumCents(group.items.map((item) => item.amountCents)))}
          </h2>
          {group.items.map((item) => (
            <article key={item.id} className="rounded-3xl bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-base font-medium">{entryDescription(item)}</h3>
                  {item.category.trim() ? (
                    <p className="mt-2">
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F6F0E6] px-2.5 py-1 text-xs text-[#241910]">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: tagColor(item.category) }} aria-hidden />
                        <span className="truncate">{item.category}</span>
                      </span>
                    </p>
                  ) : null}
                </div>
                <p className={`num text-lg ${item.amountCents < 0 ? "text-[#1E6B45]" : ""}`}>
                  {item.amountCents < 0 ? "退款 " : ""}¥{formatYuan(Math.abs(item.amountCents))}
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" className="h-11 rounded-2xl px-4" onClick={() => edit(item)}>
                  编辑
                </Button>
                <Button type="button" variant="outline" className="h-11 rounded-2xl px-4" onClick={() => setRemoving(item)}>
                  删除
                </Button>
              </div>
            </article>
          ))}
        </section>
      ))}
      {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>改这笔</DialogTitle>
            <DialogDescription>保存后写回服务器上的账。</DialogDescription>
          </DialogHeader>
          <EntryFields idPrefix="edit" values={fields} knownTags={knownTags} onChange={setFields} />
          <Button type="button" className="h-12 rounded-2xl text-base" onClick={() => void saveEdit()}>
            保存
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删掉这笔？</DialogTitle>
            <DialogDescription>
              {removing ? `${entryDescription(removing)} ¥${formatYuan(Math.abs(removing.amountCents))} 会从服务器账本里去掉。` : ""}
            </DialogDescription>
          </DialogHeader>
          <Button type="button" variant="destructive" className="h-12 rounded-2xl text-base" onClick={() => void remove()}>
            删除
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecapPanel({ today }: { today: string }) {
  const [anchor, setAnchor] = useState(today);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api<WeekSummary>(`/api/recap?anchor=${anchor}`)
        .then((next) => {
          setSummary(next);
          setError(null);
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "没能算出这一周"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [anchor]);

  async function download() {
    if (!summary) return;
    const blob = await renderRecapPng(summary);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `懒人记账本-复盘-${summary.start}_${summary.end}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const peak = Math.max(...(summary?.days.map((day) => Math.abs(day.netCents)) ?? [1]), 1);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-2xl px-3" onClick={() => summary && setAnchor(addDays(summary.start, -7))}>
          上一周
        </Button>
        <p className="text-center text-sm">{summary ? `${formatMonthDay(summary.start)} – ${formatMonthDay(summary.end)}` : "本周"}</p>
        <Button type="button" variant="outline" className="h-11 rounded-2xl px-3" disabled={!summary || summary.end >= today} onClick={() => summary && setAnchor(addDays(summary.start, 7))}>
          下一周
        </Button>
      </div>
      {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
      {summary ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="支出" cents={summary.expenseCents} />
            <Stat label="退款" cents={summary.refundCents} />
            <Stat label="结余" cents={summary.netCents} />
          </div>
          {summary.expenseCents === 0 && summary.refundCents === 0 ? <p className="rounded-3xl bg-card p-4 text-sm">这周还没有账。</p> : null}
          {summary.categories.length > 0 ? (
            <section className="rounded-3xl bg-card p-4">
              <h2 className="text-base font-medium">标签</h2>
              <ul className="mt-3 grid gap-3">
                {summary.categories.map((category) => (
                  <li key={category.category || "untagged"}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words">{tagLabel(category.category)}</span>
                      <span className="num shrink-0">¥{formatYuan(category.netCents)} · {category.sharePercent.toFixed(1)}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-[#F3E6D6]">
                      <div className="h-2 rounded-full" style={{ width: `${category.sharePercent}%`, background: tagColor(category.category) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="rounded-3xl bg-card p-4">
            <h2 className="text-base font-medium">每天结余</h2>
            <div className="mt-4 flex h-32 items-end justify-between gap-1">
              {summary.days.map((day) => (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t-md"
                      style={{
                        height: `${Math.round((Math.abs(day.netCents) / peak) * 100)}%`,
                        minHeight: day.netCents === 0 ? 0 : 4,
                        background: day.netCents < 0 ? "#1E6B45" : "#C24B24",
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#6E6256]">{day.weekday.replace("周", "")}</span>
                  <span className="num text-[10px]">{formatYuan(day.netCents)}</span>
                </div>
              ))}
            </div>
          </section>
          <Button type="button" className="h-12 rounded-2xl text-base" onClick={() => void download()}>
            导出这周的复盘图
          </Button>
          <p className="text-sm leading-6 text-[#6E6256]">每周日 20:00 会自动把这周的复盘推送到聊天里。这里的图还是按你点的这一下，用当前账本里的数字画出来。</p>
        </>
      ) : null}
    </div>
  );
}

function BackupPanel({
  count,
  ingestionConfigured,
  onChanged,
}: {
  count: number;
  ingestionConfigured: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const [report, setReport] = useState<{ backup: unknown; report: ImportReport } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportFile() {
    const response = await fetch("/api/export", { headers: { "x-ledger-request": "1" }, cache: "no-store" });
    if (!response.ok) {
      setError("没有导出");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "懒人记账本-备份.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function previewFile(file: File) {
    setError(null);
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      setError("这个文件不是 JSON");
      return;
    }
    try {
      const next = await api<ImportReport>("/api/import", { method: "POST", body: JSON.stringify({ backup, commit: false }) });
      setReport({ backup, report: next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没能读这份备份");
    }
  }

  async function commit(includeSuspects: boolean) {
    if (!report) return;
    try {
      const next = await api<ImportReport>("/api/import", {
        method: "POST",
        body: JSON.stringify({ backup: report.backup, commit: true, includeSuspects }),
      });
      setReport(null);
      await onChanged(`写入了 ${next.inserted} 笔。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有导入");
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-3xl bg-card p-4 text-sm leading-6">
        <h2 className="font-seal text-2xl">备份</h2>
        <p className="mt-2 text-[#6E6256]">服务器上现在有 {count} 笔。导出的 JSON 是完整备份，金额是整数分。这不是浏览器本地账，也还没有云同步开关。</p>
      </section>
      <Button type="button" className="h-12 rounded-2xl text-base" onClick={() => void exportFile()}>
        导出 JSON 备份
      </Button>
      <Label htmlFor="import-file">导入备份</Label>
      <Input
        id="import-file"
        type="file"
        accept="application/json"
        className="h-12 rounded-2xl bg-card px-3 py-3 text-base"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void previewFile(file);
          event.target.value = "";
        }}
      />
      <section className="rounded-3xl bg-card p-4 text-sm leading-6 text-[#6E6256]">
        <h2 className="text-base font-medium text-[#241910]">已经接上的两件事</h2>
        <p className="mt-2">
          {ingestionConfigured
            ? "聊天里发一句话就能记账，助手会直接写进这本账。"
            : "聊天里把消费发给助手、再写入这本账：接口留着，入口令牌没配，也没有接上任何聊天。"}
        </p>
        <p className="mt-2">每周日 20:00（上海时间）自动复盘已接通，会推送到聊天里。</p>
      </section>
      {error ? <p className="text-sm text-[#9C2C2C]">{error}</p> : null}
      <Button
        type="button"
        variant="outline"
        className="h-12 rounded-2xl text-base"
        onClick={() => void api("/api/session", { method: "DELETE" }).then(() => onChanged("已退出。"))}
      >
        退出登录
      </Button>
      <Button type="button" variant="outline" className="h-12 rounded-2xl text-base" onClick={() => setClearOpen(true)}>
        清空服务器上的账
      </Button>
      <Dialog open={Boolean(report)} onOpenChange={(open) => { if (!open) setReport(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入前看一眼</DialogTitle>
            <DialogDescription>编号已经在账上的会跳过。日期、金额、标签、说明都相同的，默认不写入。</DialogDescription>
          </DialogHeader>
          {report ? (
            <div className="grid gap-2 text-sm leading-6">
              <p>可写入新账 {report.report.freshCount} 笔。</p>
              <p>编号重复，将跳过 {report.report.duplicateIds.length} 笔。</p>
              <p>疑似同一笔消费 {report.report.suspects.length} 笔。</p>
              <p>格式不对 {report.report.invalid.length} 笔。</p>
              <Button type="button" className="h-12 rounded-2xl text-base" onClick={() => void commit(false)}>
                只写入新的
              </Button>
              {report.report.suspects.length > 0 ? (
                <Button type="button" variant="outline" className="h-12 rounded-2xl text-base" onClick={() => void commit(true)}>
                  连疑似重复的也写入
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空这本账？</DialogTitle>
            <DialogDescription>登录口令还在。账目会从服务器数据库删掉。输入“清空”才能继续。</DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} className="h-12 rounded-2xl text-base" aria-label="输入清空" />
          <Button
            type="button"
            variant="destructive"
            disabled={confirm !== "清空"}
            className="h-12 rounded-2xl text-base"
            onClick={() => {
              void api("/api/transactions", { method: "DELETE", body: JSON.stringify({ confirm: "清空" }) })
                .then(async () => {
                  setClearOpen(false);
                  setConfirm("");
                  await onChanged("服务器上的账已清空。");
                })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "没有清空"));
            }}
          >
            清空
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-3xl bg-card p-3">
      <p className="text-xs text-[#6E6256]">{label}</p>
      <p className={`num mt-1 text-lg ${cents < 0 ? "text-[#1E6B45]" : ""}`}>{cents < 0 ? "-" : ""}¥{formatYuan(Math.abs(cents))}</p>
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-10 shrink-0 rounded-full px-3 text-sm ${pressed ? "bg-[#C24B24] text-[#FFF8F3]" : "bg-card text-[#241910]"}`}
    >
      {children}
    </button>
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={pressed}
      onClick={onClick}
      className={`h-11 rounded-2xl text-base ${pressed ? "bg-[#241910] text-[#FFF8F3]" : "bg-card text-[#6E6256]"}`}
    >
      {children}
    </button>
  );
}

