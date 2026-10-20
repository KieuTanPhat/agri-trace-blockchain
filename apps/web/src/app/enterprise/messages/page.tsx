"use client";
import { useEffect, useState, type FormEvent } from "react";
import { request } from "@/lib/api-client";
import { useWorkspaceCommand, useWorkspaceData, textValue, type EnterpriseMember, type Items } from "@/lib/workspace";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/task-labels";
import { CommandState, EmptyState, LoadState, PageHeader } from "@/components/manage";

type Thread = {
  id: string;
  subject: string;
  createdByName: string | null;
  lastMessageAt: string;
  preview: string;
  lastAuthorName: string | null;
  participants: number;
  messages: number;
  unread: boolean;
};
type ThreadList = { items: Thread[]; counts: { unread: number }; canSend: boolean };
type Detail = {
  record: {
    id: string;
    subject: string;
    participants: { userId: string; fullName: string | null }[];
    messages: { id: string; authorName: string | null; body: string; createdAt: string; mine: boolean }[];
  };
};
const time = (value: string) => new Date(value).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

/** Internal notifications of the organization: administrators send, members reply. */
export default function MessagesPage() {
  const list = useWorkspaceData<ThreadList>("/enterprise-messages");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const detail = useWorkspaceData<Detail>(selected ? `/enterprise-messages/${selected}` : null);
  const members = useWorkspaceData<Items<EnterpriseMember>>(list.data?.canSend ? "/enterprise-workspace/members" : null);
  const send = useWorkspaceCommand();
  const reply = useWorkspaceCommand();
  const [allMembers, setAllMembers] = useState(true);
  const threads = list.data?.items ?? [];
  const open = threads.find((t) => t.id === selected);

  useEffect(() => {
    if (!selected || !open?.unread) return;
    request(`/enterprise-messages/${selected}/read`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" })
      .then(() => {
        list.reload();
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      })
      .catch(() => undefined);
    // Mark read once per opened thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, open?.unread]);

  async function compose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const recipientIds = allMembers ? undefined : form.getAll("recipientIds").map(String);
    const result = await send.run<{ record: { id: string } }>("/enterprise-messages", {
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
      ...(allMembers ? { allMembers: true } : { recipientIds }),
    });
    if (result) {
      setComposing(false);
      list.reload();
      setSelected(result.record.id);
    }
  }
  async function answer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const body = String(new FormData(formElement).get("body") ?? "");
    if (selected && (await reply.run(`/enterprise-messages/${selected}/replies`, { body }))) {
      formElement.reset();
      detail.reload();
      list.reload();
    }
  }

  return (
    <div className="manage-console">
      <PageHeader
        title="Quản lý thông báo"
        description="Thông báo nội bộ trong doanh nghiệp. Quản trị gửi cho thành viên; người nhận trả lời ngay trong cuộc hội thoại."
        actions={list.data?.canSend && <button type="button" className="button" onClick={() => { setComposing(true); setSelected(null); }}>Soạn thông báo</button>}
      />
      <LoadState {...list} />
      <div className="mail-layout">
        <section className="panel mail-list" aria-label="Danh sách thông báo">
          <p className="mail-list-head">
            Hộp thư <span>{list.data?.counts.unread ?? 0} chưa đọc</span>
          </p>
          {list.data && !threads.length && <EmptyState title="Chưa có thông báo" description="Thông báo gửi tới bạn sẽ hiện tại đây." />}
          <ul>
            {threads.map((t) => (
              <li key={t.id}>
                <button type="button" className="mail-item" data-unread={t.unread} aria-current={t.id === selected ? "true" : undefined} onClick={() => { setSelected(t.id); setComposing(false); }}>
                  <span className="mail-item-top">
                    <strong>{t.subject}</strong>
                    <time>{time(t.lastMessageAt)}</time>
                  </span>
                  <span className="mail-item-from">{t.lastAuthorName ?? t.createdByName ?? "—"} · {t.messages} tin</span>
                  <span className="mail-item-preview">{t.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel mail-view" aria-live="polite">
          {composing ? (
            <form className="workspace-form mail-compose" onSubmit={compose}>
              <h2>Soạn thông báo</h2>
              <CommandState command={send} />
              <fieldset className="enterprise-fields" disabled={send.pending || send.frozen}>
                <label>Tiêu đề<input className="input" name="subject" required minLength={3} maxLength={200} /></label>
                <div className="mail-recipients">
                  <span>Người nhận</span>
                  <label className="choice"><input type="radio" name="audience" checked={allMembers} onChange={() => setAllMembers(true)} /> Tất cả thành viên</label>
                  <label className="choice"><input type="radio" name="audience" checked={!allMembers} onChange={() => setAllMembers(false)} /> Chọn thành viên</label>
                </div>
                {!allMembers && (
                  <label>Thành viên nhận
                    <select className="input" name="recipientIds" multiple required size={Math.min(6, Math.max(3, members.data?.items.length ?? 3))}>
                      {(members.data?.items ?? []).filter((m) => m.accountStatus === "ACTIVE").map((m) => <option key={m.id} value={m.id}>{m.fullName} · {textValue(m.jobTitle)}</option>)}
                    </select>
                  </label>
                )}
                <label>Nội dung<textarea className="input" name="body" required maxLength={4000} rows={6} /></label>
              </fieldset>
              <div className="manage-header-actions">
                <button className="button" disabled={send.pending}>{"Gửi thông báo"}</button>
                <button type="button" className="button secondary" onClick={() => setComposing(false)}>Hủy</button>
              </div>
            </form>
          ) : !selected ? (
            <EmptyState title="Chọn một thông báo" description="Chọn thông báo ở bên trái để xem nội dung và trả lời." />
          ) : (
            <>
              <LoadState {...detail} />
              {detail.data && (
                <>
                  <header className="mail-view-head">
                    <h2>{detail.data.record.subject}</h2>
                    <p>{detail.data.record.participants.map((p) => p.fullName ?? "—").join(", ")}</p>
                  </header>
                  <ol className="mail-thread">
                    {detail.data.record.messages.map((m) => (
                      <li key={m.id} data-mine={m.mine}>
                        <span className="mail-meta">{m.mine ? "Bạn" : m.authorName ?? "—"} · {time(m.createdAt)}</span>
                        <p>{m.body}</p>
                      </li>
                    ))}
                  </ol>
                  <form className="mail-reply" onSubmit={answer}>
                    <CommandState command={reply} />
                    <textarea className="input" name="body" required maxLength={4000} rows={3} placeholder="Nhập nội dung trả lời…" aria-label="Nội dung trả lời" disabled={reply.pending} />
                    <button className="button" disabled={reply.pending}>{"Gửi trả lời"}</button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
