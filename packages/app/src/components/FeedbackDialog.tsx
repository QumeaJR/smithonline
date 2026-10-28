import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ownBuild } from '../lib/designBuild';
import {
  designFits,
  emailOk,
  feedbackBody,
  GITHUB_ISSUES,
  GITHUB_NEW_ISSUE,
  loadTurnstile,
  MAX_DESIGN_CHARS,
  MESSAGE_MAX,
  MESSAGE_MIN,
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

const CATEGORIES: readonly { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

/** Turnstile's state: not loaded yet (it loads on Send), loading, a token ready, failed, or no key. */
type Check = 'idle' | 'loading' | 'ready' | 'failed' | 'none';
type Outcome = { kind: 'sent'; ref: string } | { kind: 'failed'; reason: string } | null;

/**
 * Send feedback (docs/10 section 3.2): what it is about, the message, an
 * optional email, the open design if ticked, and Turnstile's check. Nothing
 * leaves the page until Send: Turnstile's script loads from Cloudflare only
 * then, and the post follows its token. The draft stays for the session when
 * the dialog closes. The GitHub link sends nothing.
 */
export function FeedbackDialog({ onClose }: { readonly onClose: () => void }) {
  const draft = useFeedback((s) => s.draft);
  const { setDraft, clearDraft } = useFeedback.getState();
  const design = useDesignStore((s) => s.design);
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>(() => (siteKey() ? 'idle' : 'none'));
  /** Send was pressed: post once the token is there, with the design or without it. */
  const [want, setWant] = useState<{ attach: boolean } | null>(null);
  const wantRef = useRef<{ attach: boolean } | null>(null);
  /** Bumped by Send to load Turnstile (again, after a failure). */
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const ids = useId();
  const messageId = `${ids}-message`;
  const countId = `${ids}-count`;
  const emailId = `${ids}-email`;
  const emailNoteId = `${ids}-email-note`;
  const emailErrorId = `${ids}-email-error`;
  const legendId = `${ids}-category`;

  // The design as a share link: the network, the load and any measured rows; part data never.
  const payload = useMemo(() => {
    try {
      return encodeDesign(ownBuild(design));
    } catch {
      return null;
    }
  }, [design]);
  const kb = payload ? Math.max(1, Math.round(payload.length / 1024)) : 0;
  const fits = designFits(payload);
  const tooLarge = draft.attach && payload !== null && !fits;

  /** Post with a fresh token; the token is good for one check only. */
  const post = async (withDesign: boolean, t: string): Promise<void> => {
    setSending(true);
    // The draft and design as they are now (this may run from Turnstile's callback).
    const now = useFeedback.getState().draft;
    let body: string | null = null;
    if (withDesign) {
      try {
        body = encodeDesign(ownBuild(useDesignStore.getState().design));
      } catch {
        body = null;
      }
    }
    const result = await sendFeedback(feedbackBody({ ...now, attach: withDesign }, t, body));
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
      // The next Send runs a fresh check: this widget's token is spent.
      const api = (globalThis as { turnstile?: { remove: (id: string) => void } }).turnstile;
      if (widgetId.current !== null) api?.remove(widgetId.current);
      widgetId.current = null;
      setCheck('idle');
    }
  };

  // Turnstile: its script and widget only after Send, and only while this dialog is open.
  useEffect(() => {
    const key = siteKey();
    if (!key || attempt === 0) return;
    let gone = false;
    loadTurnstile().then(
      (api) => {
        if (gone || !widget.current) return;
        if (widgetId.current !== null) return;
        widgetId.current = api.render(widget.current, {
          sitekey: key,
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (t) => {
            setCheck('ready');
            const pending = wantRef.current;
            wantRef.current = null;
            setWant(null);
            if (pending) void post(pending.attach, t);
            else setToken(t);
          },
          'error-callback': () => {
            setCheck('failed');
            wantRef.current = null;
            setWant(null);
          },
          'expired-callback': () => {
            setToken(null);
            setCheck('loading');
          },
        });
      },
      () => {
        if (gone) return;
        setCheck('failed');
        wantRef.current = null;
        setWant(null);
      },
    );
    return () => {
      gone = true;
    };
    // post uses the stores and stable setters only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(
    () => () => {
      const api = (globalThis as { turnstile?: { remove: (id: string) => void } }).turnstile;
      if (widgetId.current !== null) api?.remove(widgetId.current);
      widgetId.current = null;
    },
    [],
  );

  const length = [...draft.message].length;
  const emailGood = emailOk(draft.email);
  const canSend =
    messageReady(draft.message) && emailGood && !sending && want === null && check !== 'none';

  const send = (withDesign: boolean): void => {
    if (!canSend) return;
    if (!withDesign && draft.attach) setDraft({ attach: false });
    setOutcome(null);
    if (token !== null) {
      setToken(null);
      void post(withDesign, token);
      return;
    }
    // No token yet: Turnstile loads now, and its callback posts.
    wantRef.current = { attach: withDesign };
    setWant({ attach: withDesign });
    if (check !== 'loading') {
      setCheck('loading');
      setAttempt((n) => n + 1);
    }
  };

  const sendTitle =
    check === 'none'
      ? 'Feedback is not set up on this site; open a GitHub issue instead'
      : !messageReady(draft.message)
        ? `Write at least ${MESSAGE_MIN} characters`
        : !emailGood
          ? 'Check the email address, or leave it empty'
          : tooLarge
            ? 'The design is too large to attach; send without it'
            : undefined;

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
            disabled={!canSend || tooLarge}
            onClick={() => send(draft.attach)}
            title={sendTitle}
          >
            {sending ? 'Sending' : want ? 'Checking' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="feedback-body">
        <div className="feedback-field" role="radiogroup" aria-labelledby={legendId}>
          <span className="feedback-label" id={legendId}>
            What is it about?
          </span>
          <div className="feedback-category">
            {CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={`feedback-choice${draft.category === c.value ? ' on' : ''}`}
              >
                <input
                  type="radio"
                  name={`${ids}-category`}
                  value={c.value}
                  checked={draft.category === c.value}
                  onChange={() => setDraft({ category: c.value })}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <div className="feedback-field">
          <label className="feedback-label" htmlFor={messageId}>
            Message
          </label>
          <textarea
            id={messageId}
            rows={6}
            maxLength={MESSAGE_MAX}
            value={draft.message}
            placeholder="What happened, or what would help? For a bug: what you did and what you expected."
            aria-describedby={countId}
            onChange={(e) => setDraft({ message: e.target.value })}
          />
          <span id={countId} className="muted small feedback-count" aria-live="polite">
            {length} of {MESSAGE_MAX}
          </span>
        </div>
        <div className="feedback-field">
          <label className="feedback-label" htmlFor={emailId}>
            Email, optional
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            maxLength={254}
            value={draft.email}
            placeholder="only if you want an answer"
            aria-invalid={!emailGood}
            aria-describedby={emailGood ? emailNoteId : `${emailErrorId} ${emailNoteId}`}
            onChange={(e) => setDraft({ email: e.target.value })}
          />
          {!emailGood && (
            <span id={emailErrorId} className="small warn-text">
              This does not look like an email address. Correct it, or leave the field empty: it is
              optional.
            </span>
          )}
          <span id={emailNoteId} className="muted small">
            Used only to answer this message. Deleted after 90 days, or earlier on request.
          </span>
        </div>
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
            Sent as a share link: the network and the load, including the rows read from your files
            and their file names. The files themselves and library part data are not attached.
          </span>
          {draft.attach && payload && fits && (
            <span className="muted small">Adds about {kb} KB.</span>
          )}
          {tooLarge && (
            <div className="feedback-too-large" role="alert">
              <span className="small warn-text">
                This design is about {kb} KB, more than the {Math.round(MAX_DESIGN_CHARS / 1024)} KB
                that can be attached (its measured rows make it large).
              </span>
              <Button size="sm" disabled={!canSend} onClick={() => send(false)}>
                Send without the design
              </Button>
            </div>
          )}
        </div>
        <div className="feedback-check" ref={widget} />
        {check !== 'none' && (
          <p className="muted small">
            Send first loads Cloudflare Turnstile, a check that you are not a robot, from
            challenges.cloudflare.com (Help, Feedback and privacy).
          </p>
        )}
        {check === 'none' && (
          <p className="small warn-text" role="note">
            Feedback is not set up on this site. Your text is still here; open a GitHub issue
            instead.
          </p>
        )}
        {check === 'failed' && (
          <p className="small warn-text" role="note">
            The check that you are not a robot could not load (offline, or blocked). Your text is
            still here; press Send to try again, or open a GitHub issue.
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
