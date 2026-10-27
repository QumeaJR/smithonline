import { useEffect, useMemo, useRef, useState } from 'react';
import { ownBuild } from '../lib/designBuild';
import {
  emailOk,
  feedbackBody,
  GITHUB_ISSUES,
  GITHUB_NEW_ISSUE,
  loadTurnstile,
  MESSAGE_MAX,
  messageReady,
  sendFeedback,
  siteKey,
  useFeedback,
  type FeedbackCategory,
} from '../lib/feedback';
import { encodeDesign } from '../lib/share';
import { useDesignStore } from '../store/useDesignStore';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Segmented } from './ui/Segmented';

const CATEGORIES: readonly { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

type Check = 'loading' | 'ready' | 'failed' | 'none';
type Outcome = { kind: 'sent'; ref: string } | { kind: 'failed'; reason: string } | null;

/**
 * Send feedback (docs/10 section 3.2): what it is about, the message, an
 * optional email, the open design if ticked, and Turnstile's check, whose
 * script loads only now. The draft stays for the session when the dialog
 * closes. Nothing is sent until Send; the GitHub link sends nothing.
 */
export function FeedbackDialog({ onClose }: { readonly onClose: () => void }) {
  const draft = useFeedback((s) => s.draft);
  const { setDraft, clearDraft } = useFeedback.getState();
  const design = useDesignStore((s) => s.design);
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>(() => (siteKey() ? 'loading' : 'none'));
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const widget = useRef<HTMLDivElement>(null);

  // The design as a share link: the network, the load and any measured rows; part data never.
  const payload = useMemo(() => {
    try {
      return encodeDesign(ownBuild(design));
    } catch {
      return null;
    }
  }, [design]);
  const kb = payload ? Math.max(1, Math.round(payload.length / 1024)) : 0;

  // Turnstile: its script and widget only while this dialog is open.
  useEffect(() => {
    const key = siteKey();
    if (!key) return;
    let id: string | null = null;
    let gone = false;
    loadTurnstile().then(
      (api) => {
        if (gone || !widget.current) return;
        id = api.render(widget.current, {
          sitekey: key,
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (t) => {
            setToken(t);
            setCheck('ready');
          },
          'error-callback': () => setCheck('failed'),
          'expired-callback': () => {
            setToken(null);
            setCheck('loading');
          },
        });
      },
      () => {
        if (!gone) setCheck('failed');
      },
    );
    return () => {
      gone = true;
      const api = (globalThis as { turnstile?: { remove: (id: string) => void } }).turnstile;
      if (id !== null) api?.remove(id);
    };
  }, []);

  const length = [...draft.message].length;
  const ready = messageReady(draft.message) && emailOk(draft.email) && token !== null && !sending;

  const send = async (): Promise<void> => {
    if (!ready || token === null) return;
    setSending(true);
    const result = await sendFeedback(feedbackBody(draft, token, payload));
    setSending(false);
    // A token is good for one check: the next send needs a fresh one.
    setToken(null);
    if (result.ok) {
      setOutcome({ kind: 'sent', ref: result.ref });
      clearDraft();
      const { setMessage } = useDesignStore.getState();
      setMessage(`Feedback sent, reference ${result.ref}`, {
        action: {
          label: 'Copy reference',
          run: () => void navigator.clipboard?.writeText(result.ref).catch(() => undefined),
        },
      });
    } else {
      setOutcome({ kind: 'failed', reason: result.reason });
      setCheck(siteKey() ? 'loading' : 'none');
      // Turnstile hands out the next token after a reset.
      const api = (globalThis as { turnstile?: { reset?: () => void } }).turnstile;
      api?.reset?.();
    }
  };

  const github = (
    <a
      className="quiet-link"
      href={GITHUB_NEW_ISSUE}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens GitHub in a new tab; nothing from the app is sent"
    >
      Prefer GitHub? Open an issue
    </a>
  );

  if (outcome?.kind === 'sent') {
    return (
      <Dialog
        title="Send feedback"
        onClose={onClose}
        closeLabel="Close feedback"
        className="feedback"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="feedback-body">
          <p role="status">
            Thank you. Reference <strong className="mono">{outcome.ref}</strong>. To have this
            message deleted, open an issue on{' '}
            <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>{' '}
            with the reference and no personal details; it is deleted within 30 days.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Send feedback"
      onClose={onClose}
      closeLabel="Close feedback"
      className="feedback"
      footer={
        <>
          {github}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => void send()}
            title={
              check === 'none'
                ? 'Feedback is not set up on this site; open a GitHub issue instead'
                : !messageReady(draft.message)
                  ? `Write at least 10 characters`
                  : token === null
                    ? 'Waiting for the check that you are not a robot'
                    : undefined
            }
          >
            {sending ? 'Sending' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="feedback-body">
        <div className="feedback-field">
          <span className="feedback-label" id="feedback-category">
            What is it about?
          </span>
          <Segmented
            ariaLabel="What is it about?"
            className="feedback-category"
            value={draft.category}
            onChange={(v: FeedbackCategory) => setDraft({ category: v })}
            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </div>
        <label className="feedback-field">
          <span className="feedback-label">Message</span>
          <textarea
            rows={6}
            maxLength={MESSAGE_MAX}
            value={draft.message}
            placeholder="What happened, or what would help? For a bug: what you did and what you expected."
            onChange={(e) => setDraft({ message: e.target.value })}
          />
          <span className="muted small feedback-count" aria-live="polite">
            {length} of {MESSAGE_MAX}
          </span>
        </label>
        <label className="feedback-field">
          <span className="feedback-label">Email, optional</span>
          <input
            type="email"
            autoComplete="email"
            maxLength={254}
            value={draft.email}
            placeholder="only if you want an answer"
            aria-invalid={!emailOk(draft.email)}
            onChange={(e) => setDraft({ email: e.target.value })}
          />
          <span className="muted small">
            Used only to answer this message. Deleted after 90 days, or earlier on request.
          </span>
        </label>
        <div className="feedback-field">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.attach}
              disabled={payload === null}
              onChange={(e) => setDraft({ attach: e.target.checked })}
            />
            Attach the open design
          </label>
          <span className="muted small">
            Sent as a share link: the network, the load and any measured rows in the design. Library
            part data and your files are never attached.
          </span>
          {draft.attach && payload && <span className="muted small">Adds about {kb} KB.</span>}
        </div>
        <div className="feedback-check" ref={widget} />
        {check === 'none' && (
          <p className="small warn-text" role="note">
            Feedback is not set up on this site. Your text is still here; open a GitHub issue
            instead.
          </p>
        )}
        {check === 'failed' && (
          <p className="small warn-text" role="note">
            The check that you are not a robot could not load (offline, or blocked). Your text is
            still here; try again later, or open a GitHub issue.
          </p>
        )}
        {outcome?.kind === 'failed' && (
          <p className="small warn-text" role="alert">
            Could not send ({outcome.reason}). Your text is still here; try again, or open a GitHub
            issue.
          </p>
        )}
      </div>
    </Dialog>
  );
}
