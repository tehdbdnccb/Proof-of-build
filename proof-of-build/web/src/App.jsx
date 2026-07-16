import { useState } from "react";
import { fetchHistory, EXPLORER_TX_BASE } from "./lib/contract.js";

// Set this to the official hackathon start time (UTC) to flag anchors that
// predate the event — the same check judges and judging agents do by hand.
const HACKATHON_START = import.meta.env.VITE_HACKATHON_START_ISO
  ? new Date(import.meta.env.VITE_HACKATHON_START_ISO)
  : null;

function formatTimestamp(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateHash(hash) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export default function App() {
  const [address, setAddress] = useState("");
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleLookup(e) {
    e.preventDefault();
    if (!address) return;

    setLoading(true);
    setError(null);
    setHistory(null);

    try {
      const result = await fetchHistory(address.trim());
      setHistory(result);
    } catch (err) {
      setError(err.message || "Could not read history for that address.");
    } finally {
      setLoading(false);
    }
  }

  const latest = history && history.length > 0 ? history[history.length - 1] : null;
  const first = history && history.length > 0 ? history[0] : null;
  const predatesEvent = first && HACKATHON_START && first.timestamp < HACKATHON_START.getTime();

  return (
    <div className="page">
      <header className="masthead">
        <p className="masthead-eyebrow">Proof of Build</p>
        <h1>A build ledger you can't backdate.</h1>
        <p>
          Every push anchors a hash of your commit on Monad, with a timestamp nobody — including
          you — can quietly rewrite later. Paste a builder's address to see their unfalsifiable
          timeline.
        </p>
      </header>

      <form className="lookup" onSubmit={handleLookup}>
        <input
          type="text"
          placeholder="0x… builder address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !address}>
          {loading ? "Reading chain…" : "Look up"}
        </button>
      </form>

      {error && <p className="status-line error">{error}</p>}

      {predatesEvent && (
        <div className="flag-banner">
          Flagged: this builder's first anchor is dated before the hackathon's official start
          time.
        </div>
      )}

      {latest && (
        <div className="hero-seal">
          <div className="wax-seal">
            <span>Sealed</span>
          </div>
          <div className="hero-copy">
            <p className="hero-label">Most recent anchor</p>
            <p className="hero-title">{latest.label}</p>
            <p className="hero-meta">{formatTimestamp(latest.timestamp)} · on-chain, immutable</p>
          </div>
        </div>
      )}

      {history && (
        <div className="ledger">
          {history.length === 0 ? (
            <div className="empty-state">No anchors recorded for this address yet.</div>
          ) : (
            history
              .slice()
              .reverse()
              .map((entry) => (
                <div className="ledger-row" key={entry.txHash}>
                  <span className="ts">{formatTimestamp(entry.timestamp)}</span>
                  <span className="label">{entry.label}</span>
                  {EXPLORER_TX_BASE ? (
                    <a
                      className="hash-link"
                      href={`${EXPLORER_TX_BASE}${entry.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {truncateHash(entry.txHash)}
                    </a>
                  ) : (
                    <span className="hash-link">{truncateHash(entry.txHash)}</span>
                  )}
                </div>
              ))
          )}
        </div>
      )}

      <p className="footnote">
        Reads directly from the ProofOfBuild contract on Monad — no backend, no database. What
        you see here is exactly what's on-chain.
      </p>
    </div>
  );
}