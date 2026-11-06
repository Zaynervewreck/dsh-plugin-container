/** Theme-aware styles for the Docker panel. */
const STYLE_TAG = 'dsh-plugin-container/styles.css'

const CSS = `
.dsh-docker-page {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary, #17181c);
  background: var(--dsw-alias-bg-base, #fff);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 13px;
  line-height: 1.45;
}
.dsh-docker-page *,
.dsh-docker-page *::before,
.dsh-docker-page *::after { box-sizing: border-box; }
[data-platform=darwin] .dsh-docker-page { padding-top: var(--dsh-frame-top-clearance, 0px); }

.dsh-docker-header {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px clamp(20px, 3.5vw, 40px) 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
}
.dsh-docker-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dsh-docker-mark {
  width: 38px; height: 38px; flex: none;
  display: grid; place-items: center;
  border-radius: 11px;
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  background: var(--dsw-alias-bg-layer-2, #f4f5f8);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
}
.dsh-docker-heading { min-width: 0; }
.dsh-docker-title { margin: 0; font-size: 19px; line-height: 26px; font-weight: 600; letter-spacing: -.01em; }
.dsh-docker-subtitle { margin: 2px 0 0; color: var(--dsw-alias-label-secondary, #60636c); font-size: 12px; line-height: 18px; }
.dsh-docker-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-docker-headmeta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

.dsh-docker-status {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border-radius: 999px;
  font-size: 12px; line-height: 1; white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #60636c);
  background: var(--dsw-alias-bg-layer-2, #f4f5f8);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
}
.dsh-docker-status[data-state=running] { color: var(--dsw-alias-state-success-primary, #168a4b); background: var(--dsw-alias-state-success-tertiary, rgba(22,138,75,.1)); }
.dsh-docker-status[data-state=stopped] { color: var(--dsw-alias-label-secondary, #60636c); }
.dsh-docker-status[data-state=starting] { color: var(--dsw-alias-state-warn-primary, #a35f00); background: var(--dsw-alias-state-warn-tertiary, rgba(163,95,0,.1)); }
.dsh-docker-status[data-state=error] { color: var(--dsw-alias-label-error, #d33c3c); background: var(--dsw-alias-state-error-primary, rgba(211,60,60,.08)); }
.dsh-docker-status[data-state=remote] { color: var(--dsw-alias-state-business-primary, #3156c8); }
.dsh-docker-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.dsh-docker-status[data-state=running] .dsh-docker-dot { box-shadow: 0 0 0 3px var(--dsw-alias-state-success-tertiary, rgba(22,138,75,.12)); }

.dsh-docker-btn {
  appearance: none; border: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 7px;
  font: inherit; font-size: 12.5px; font-weight: 500; white-space: nowrap;
  color: var(--dsw-alias-label-primary, #17181c);
  background: var(--dsw-alias-bg-layer-2, #f4f5f8);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
  transition: background .12s ease, border-color .12s ease, opacity .12s ease;
}
.dsh-docker-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.045)); }
.dsh-docker-btn:active { background: var(--dsw-alias-interactive-bg-active, rgba(0,0,0,.08)); }
.dsh-docker-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4d6bfe); outline-offset: 2px; }
.dsh-docker-btn[disabled] { opacity: .45; cursor: not-allowed; }
.dsh-docker-btn.dsh-docker-primary {
  color: var(--dsw-alias-label-primary-foreground, #fff);
  background: var(--dsw-alias-button-primary-fill, #3156c8);
  border-color: transparent;
}
.dsh-docker-btn.dsh-docker-primary:hover { background: var(--dsw-alias-button-primary-hover, #2848ad); }
.dsh-docker-btn.dsh-docker-danger { color: var(--dsw-alias-label-error, #d33c3c); }
.dsh-docker-btn.dsh-docker-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(211,60,60,.09)); }
.dsh-docker-btn.dsh-docker-danger-solid {
  color: #fff; background: var(--dsw-alias-label-error, #d33c3c); border-color: transparent;
}
.dsh-docker-btn.dsh-docker-ghost { background: transparent; border-color: transparent; }
.dsh-docker-btn.dsh-docker-ghost:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.045)); }
.dsh-docker-btn.dsh-docker-sm { height: 26px; padding: 0 9px; font-size: 12px; border-radius: 6px; }
.dsh-docker-btn.dsh-docker-lg { height: 34px; padding: 0 14px; font-size: 13px; }
.dsh-docker-icon-btn {
  position: relative;
  appearance: none; border: .5px solid transparent; background: transparent; cursor: pointer;
  width: 30px; height: 30px; border-radius: 7px; padding: 0;
  display: inline-grid; place-items: center;
  color: var(--dsw-alias-label-secondary, #60636c);
}
.dsh-docker-icon-btn:hover { color: var(--dsw-alias-label-primary, #17181c); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.045)); }
.dsh-docker-icon-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4d6bfe); outline-offset: 2px; }
.dsh-docker-icon-btn[disabled] { opacity: .4; cursor: not-allowed; }
.dsh-docker-icon-btn.dsh-docker-sm { width: 26px; height: 26px; }

.dsh-docker-tooltip {
  position: fixed; z-index: 10000; transform: translate(-50%, -100%);
  padding: 5px 8px; border-radius: 6px; pointer-events: none; white-space: nowrap;
  color: var(--dsw-alias-label-primary, #fff); background: var(--dsw-alias-bg-inverse, #23252b);
  font-size: 11px; line-height: 1.2; box-shadow: 0 4px 14px rgba(0,0,0,.18);
}

.dsh-docker-select, .dsh-docker-input {
  appearance: none; -webkit-appearance: none;
  height: 30px; min-width: 0; padding: 0 9px; border-radius: 7px;
  color: var(--dsw-alias-label-primary, #17181c);
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.14));
  font: inherit; font-size: 12.5px;
}
.dsh-docker-select { padding-right: 26px; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 13px) 13px, calc(100% - 9px) 13px; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; }
.dsh-docker-select:focus, .dsh-docker-input:focus { outline: 2px solid var(--dsw-focus-ring-color, #4d6bfe); outline-offset: 1px; border-color: transparent; }
.dsh-docker-input::placeholder, .dsh-docker-select:disabled { color: var(--dsw-alias-label-tertiary, #8a8d96); }
.dsh-docker-input[disabled] { opacity: .6; }

.dsh-docker-banner {
  flex: none; margin: 12px clamp(20px, 3.5vw, 40px) 0;
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 14px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1));
}
.dsh-docker-banner[data-tone=warn] { background: var(--dsw-alias-state-warn-tertiary, rgba(163,95,0,.07)); border-color: transparent; }
.dsh-docker-banner[data-tone=error] { background: var(--dsw-alias-bg-layer-1, #fff); border-color: var(--dsw-alias-label-error, #d33c3c); }
.dsh-docker-banner[data-tone=info] { background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dsh-docker-banner-icon { flex: none; margin-top: 1px; color: var(--dsw-alias-label-secondary, #60636c); }
.dsh-docker-banner[data-tone=warn] .dsh-docker-banner-icon { color: var(--dsw-alias-state-warn-primary, #a35f00); }
.dsh-docker-banner[data-tone=error] .dsh-docker-banner-icon { color: var(--dsw-alias-label-error, #d33c3c); }
.dsh-docker-banner-main { min-width: 0; flex: 1; }
.dsh-docker-banner-title { font-weight: 600; font-size: 12.5px; }
.dsh-docker-banner-text { margin-top: 2px; color: var(--dsw-alias-label-secondary, #60636c); font-size: 12px; overflow-wrap: anywhere; }
.dsh-docker-banner-actions { flex: none; display: flex; align-items: center; gap: 6px; }

.dsh-docker-tabs {
  flex: none; display: flex; align-items: center; gap: 2px;
  padding: 8px clamp(20px, 3.5vw, 40px) 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
}
.dsh-docker-tab {
  appearance: none; border: 0; background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 10px 9px; margin-bottom: -1px;
  color: var(--dsw-alias-label-secondary, #60636c);
  font: inherit; font-size: 12.5px; white-space: nowrap;
  border-bottom: 2px solid transparent;
}
.dsh-docker-tab:hover { color: var(--dsw-alias-label-primary, #17181c); }
.dsh-docker-tab[aria-selected=true] { color: var(--dsw-alias-label-primary, #17181c); border-bottom-color: var(--dsw-alias-brand-primary, #3156c8); font-weight: 600; }
.dsh-docker-tab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4d6bfe); outline-offset: -2px; border-radius: 4px; }
.dsh-docker-tab-count {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px;
  display: inline-grid; place-items: center;
  font-size: 10.5px; font-weight: 500;
  color: var(--dsw-alias-label-secondary, #60636c);
  background: var(--dsw-alias-bg-layer-2, #f1f2f4);
}
.dsh-docker-tab[aria-selected=true] .dsh-docker-tab-count { color: var(--dsw-alias-brand-primary, #3156c8); background: var(--dsw-alias-bg-layer-2, #eef1fb); }

.dsh-docker-body { flex: 1; min-height: 0; overflow: auto; padding: 20px clamp(20px, 3.5vw, 40px) 36px; }
.dsh-docker-body.dsh-docker-body-fill { overflow: hidden; padding-bottom: 20px; display: flex; flex-direction: column; }
.dsh-docker-stack { display: flex; flex-direction: column; gap: 16px; }
.dsh-docker-grid-2 { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(260px, 1fr); gap: 16px; align-items: start; }
.dsh-docker-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }

.dsh-docker-card {
  min-width: 0; border-radius: 11px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1));
  box-shadow: var(--dsw-elevation-soft, none);
}
.dsh-docker-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 0; }
.dsh-docker-card-title { margin: 0; font-size: 13px; font-weight: 600; }
.dsh-docker-card-sub { margin: 3px 0 0; color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 11.5px; }
.dsh-docker-card-body { padding: 14px 16px; }
.dsh-docker-card-body.dsh-docker-flush { padding: 0; }

.dsh-docker-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.dsh-docker-stat {
  min-width: 0; padding: 13px 14px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1));
}
.dsh-docker-stat-label { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 11px; white-space: nowrap; }
.dsh-docker-stat-value { margin-top: 6px; font-size: 21px; line-height: 25px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.dsh-docker-stat-detail { margin-top: 3px; color: var(--dsw-alias-label-secondary, #60636c); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.dsh-docker-runtime-head { display: flex; align-items: center; gap: 9px; }
.dsh-docker-runtime-name { font-weight: 600; font-size: 14px; }
.dsh-docker-runtime-tag { margin-left: 2px; }
.dsh-docker-kv { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 7px 12px; margin-top: 12px; font-size: 12px; }
.dsh-docker-kv-key { color: var(--dsw-alias-label-tertiary, #8a8d96); white-space: nowrap; }
.dsh-docker-kv-value { min-width: 0; color: var(--dsw-alias-label-primary, #17181c); overflow-wrap: anywhere; }
.dsh-docker-middle { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

.dsh-docker-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dsh-docker-toolbar-left, .dsh-docker-toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dsh-docker-search { position: relative; display: flex; align-items: center; }
.dsh-docker-search .dsh-docker-input { padding-left: 28px; width: 220px; max-width: 100%; }
.dsh-docker-search-icon { position: absolute; left: 9px; color: var(--dsw-alias-label-tertiary, #8a8d96); pointer-events: none; }
.dsh-docker-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f1f2f4); }
.dsh-docker-seg button { appearance: none; border: 0; cursor: pointer; height: 24px; padding: 0 9px; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary, #60636c); font: inherit; font-size: 12px; }
.dsh-docker-seg button[aria-pressed=true] { background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #17181c); box-shadow: var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,.06)); }
.dsh-docker-provider-switch { flex: 0 0 auto; }
.dsh-docker-provider-switch button { height: 30px; padding: 0 10px; font-size: 12px; }
.dsh-docker-provider-switch button:disabled { cursor: not-allowed; opacity: .55; }

.dsh-docker-run-form { display: flex; flex-direction: column; gap: 12px; }
.dsh-docker-image-picker { display: flex; align-items: center; gap: 6px; }
.dsh-docker-image-picker .dsh-docker-select { flex: 1; min-width: 0; }
.dsh-docker-run-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dsh-docker-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsh-docker-field > span { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #60636c); }
.dsh-docker-textarea { height: auto; min-height: 72px; padding: 8px 10px; resize: vertical; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); line-height: 1.5; }
.dsh-docker-form-error { color: var(--dsw-alias-label-error, #d33c3c); font-size: 12px; }


.dsh-docker-table-wrap { overflow: auto; border-radius: 0 0 11px 11px; }
.dsh-docker-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
.dsh-docker-table th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 500; color: var(--dsw-alias-label-tertiary, #8a8d96);
  padding: 9px 12px; background: var(--dsw-alias-bg-layer-1, #fff);
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08));
  white-space: nowrap;
}
.dsh-docker-table td { padding: 10px 12px; vertical-align: middle; border-bottom: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.07)); }
.dsh-docker-table tbody tr:hover td { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.025)); }
.dsh-docker-table tbody tr:last-child td { border-bottom: 0; }
.dsh-docker-table .dsh-docker-col-actions { width: 1%; white-space: nowrap; text-align: right; }
.dsh-docker-table .dsh-docker-col-num { text-align: right; font-variant-numeric: tabular-nums; }
.dsh-docker-row-title { font-weight: 500; color: var(--dsw-alias-label-primary, #17181c); }
.dsh-docker-row-actions { display: inline-flex; align-items: center; gap: 2px; justify-content: flex-end; }
.dsh-docker-mono { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; }
.dsh-docker-muted { color: var(--dsw-alias-label-tertiary, #8a8d96); }
.dsh-docker-truncate { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-docker-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.dsh-docker-chip {
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 240px; padding: 1px 6px; border-radius: 4px;
  color: var(--dsw-alias-label-secondary, #60636c);
  background: var(--dsw-alias-bg-layer-2, #f4f5f8);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.07));
  font-size: 10.5px; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-docker-chip.dsh-docker-chip-code { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); }
.dsh-docker-state { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 11.5px; }
.dsh-docker-state .dsh-docker-dot { width: 6px; height: 6px; }
.dsh-docker-state[data-state=running] { color: var(--dsw-alias-state-success-primary, #168a4b); }
.dsh-docker-state[data-state=paused], .dsh-docker-state[data-state=restarting] { color: var(--dsw-alias-state-warn-primary, #a35f00); }
.dsh-docker-state[data-state=exited], .dsh-docker-state[data-state=dead] { color: var(--dsw-alias-label-tertiary, #8a8d96); }
.dsh-docker-state[data-state=dead] { color: var(--dsw-alias-label-error, #d33c3c); }

.dsh-docker-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; padding: 52px 20px; }
.dsh-docker-empty-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary, #8a8d96); background: var(--dsw-alias-bg-layer-2, #f4f5f8); }
.dsh-docker-empty-title { font-size: 13px; font-weight: 600; }
.dsh-docker-empty-text { max-width: 420px; color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 12px; line-height: 19px; }
.dsh-docker-error { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 44px 20px; }
.dsh-docker-error-title { font-weight: 600; color: var(--dsw-alias-label-error, #d33c3c); font-size: 13px; }
.dsh-docker-error-text { max-width: 560px; color: var(--dsw-alias-label-secondary, #60636c); font-size: 12px; overflow-wrap: anywhere; }

.dsh-docker-skeleton { display: flex; flex-direction: column; gap: 9px; padding: 16px; }
.dsh-docker-skel-line { height: 12px; border-radius: 5px; background: linear-gradient(90deg, var(--dsw-alias-bg-layer-2, #f1f2f4), var(--dsw-alias-bg-layer-3, #e7e9ee), var(--dsw-alias-bg-layer-2, #f1f2f4)); background-size: 200% 100%; animation: dsh-docker-shimmer 1.2s ease-in-out infinite; }
.dsh-docker-skel-line:nth-child(2) { width: 80%; }
.dsh-docker-skel-line:nth-child(3) { width: 64%; }

.dsh-docker-modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: grid; place-items: center; padding: 24px;
  background: rgba(12, 14, 20, .32);
  backdrop-filter: blur(2px);
}
.dsh-docker-modal {
  width: min(560px, 100%); max-height: min(78vh, 720px);
  display: flex; flex-direction: column;
  border-radius: 13px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 20px 60px rgba(0,0,0,.22));
}
.dsh-docker-modal.dsh-docker-modal-wide { width: min(820px, 100%); }
.dsh-docker-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08)); }
.dsh-docker-modal-title { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-docker-modal-sub { margin: 3px 0 0; color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 11.5px; }
.dsh-docker-modal-body { min-height: 0; overflow: auto; padding: 16px 18px; }
.dsh-docker-modal-foot { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 18px; border-top: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08)); background: var(--dsw-alias-bg-layer-1, #fff); }
.dsh-docker-modal-danger { color: var(--dsw-alias-label-error, #d33c3c); background: var(--dsw-alias-bg-layer-2, #fdf3f3); border-radius: 8px; padding: 10px 12px; font-size: 12px; }
.dsh-docker-json { margin: 0; max-height: 54vh; overflow: auto; white-space: pre; tab-size: 2; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 11.5px; line-height: 1.55; padding: 12px; border-radius: 8px; background: var(--dsw-alias-markdown-code-block, #f6f7f9); border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08)); }

.dsh-docker-toast-wrap { position: fixed; right: 18px; bottom: 18px; z-index: 1100; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 36px)); }
.dsh-docker-toast { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 9px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary, #17181c); background: var(--dsw-alias-toast-bg, #fff); box-shadow: var(--dsw-elevation-prominent, 0 8px 30px rgba(0,0,0,.18)); border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1)); animation: dsh-docker-toast-in .16s ease-out; }
.dsh-docker-toast[data-tone=error] { color: var(--dsw-alias-label-error, #d33c3c); }
.dsh-docker-toast[data-tone=success] { color: var(--dsw-alias-state-success-primary, #168a4b); }
.dsh-docker-toast-main { flex: 1; min-width: 0; overflow-wrap: anywhere; }

.dsh-docker-console { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.dsh-docker-console-form { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 11px; background: var(--dsw-alias-bg-layer-1, #fff); border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1)); }
.dsh-docker-console-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-docker-console-prompt { flex: none; color: var(--dsw-alias-label-tertiary, #8a8d96); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 12px; }
.dsh-docker-console-input { flex: 1; height: 34px; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 12.5px; }
.dsh-docker-console-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-docker-console-cwd { flex: 1; min-width: 160px; max-width: 420px; height: 28px; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 11.5px; }
.dsh-docker-console-hint { color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 11px; }
.dsh-docker-console-output { flex: 1; min-height: 0; display: flex; flex-direction: column; border-radius: 11px; overflow: hidden; background: var(--dsw-alias-markdown-code-block, #f6f7f9); border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1)); }
.dsh-docker-output-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08)); background: var(--dsw-alias-markdown-code-block-banner, rgba(0,0,0,.025)); }
.dsh-docker-output-title { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #60636c); }
.dsh-docker-output-cmd { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); color: var(--dsw-alias-label-primary, #17181c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-docker-output-actions { display: flex; align-items: center; gap: 4px; flex: none; }
.dsh-docker-output-pre { flex: 1; min-height: 120px; margin: 0; padding: 12px 14px; overflow: auto; white-space: pre-wrap; word-break: break-word; tab-size: 2; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-primary, #17181c); }
.dsh-docker-output-pre.dsh-docker-no-output { display: grid; place-items: center; color: var(--dsw-alias-label-tertiary, #8a8d96); font-family: var(--dsw-font-family, sans-serif); font-size: 12px; }
.dsh-docker-run-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-top: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.08)); color: var(--dsw-alias-label-secondary, #60636c); font-size: 11.5px; }
.dsh-docker-run-status .dsh-docker-dot { background: var(--dsw-alias-state-success-primary, #168a4b); }
.dsh-docker-run-status[data-status=failed] .dsh-docker-dot, .dsh-docker-run-status[data-status=timed-out] .dsh-docker-dot { background: var(--dsw-alias-label-error, #d33c3c); }
.dsh-docker-run-status[data-status=cancelled] .dsh-docker-dot { background: var(--dsw-alias-label-tertiary, #8a8d96); }
.dsh-docker-run-status[data-status=exited] .dsh-docker-dot { background: var(--dsw-alias-label-tertiary, #8a8d96); }
.dsh-docker-attach-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0 8px; }
.dsh-docker-attach-screen { height: 390px; overflow: auto; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12)); background: #111318; color: #e8eaf0; padding: 10px 12px; outline: none; cursor: text; }
.dsh-docker-attach-screen:focus { border-color: var(--dsw-focus-ring-color, #4d6bfe); box-shadow: 0 0 0 1px var(--dsw-focus-ring-color, #4d6bfe); }
.dsh-docker-attach-pre { margin: 0; padding: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 12px; line-height: 1.5; }
.dsh-docker-attach-pre.dsh-docker-no-output { color: rgba(232,234,240,.58); font-family: var(--dsw-font-family, sans-serif); font-size: 12px; }
.dsh-docker-attach-error { color: #ff9b9b; }
.dsh-docker-attach-loading { display: flex; align-items: center; gap: 8px; color: rgba(232,234,240,.72); font-size: 12px; padding: 4px; }

.dsh-docker-kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 4px; border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.14)); color: var(--dsw-alias-label-tertiary, #8a8d96); font-size: 10px; font-family: var(--dsw-font-family, sans-serif); }

.dsh-docker-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-docker-quick { appearance: none; cursor: pointer; border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.1)); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-secondary, #60636c); border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 11px; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); }
.dsh-docker-quick:hover { color: var(--dsw-alias-label-primary, #17181c); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04)); }
.dsh-docker-divider { height: 1px; background: var(--dsw-alias-border-l3, rgba(0,0,0,.08)); margin: 12px 0; }
.dsh-docker-link { color: var(--dsw-alias-link, #3156c8); text-decoration: none; }
.dsh-docker-link:hover { text-decoration: underline; }

.dsh-docker-spinner { display: inline-block; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: dsh-docker-spin .75s linear infinite; flex: none; }
@keyframes dsh-docker-spin { to { transform: rotate(360deg); } }
@keyframes dsh-docker-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes dsh-docker-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

@media (max-width: 1180px) {
  .dsh-docker-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dsh-docker-grid-2 { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .dsh-docker-header { flex-direction: column; align-items: stretch; }
  .dsh-docker-header-actions, .dsh-docker-headmeta { justify-content: flex-start; }
  .dsh-docker-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-docker-grid-3 { grid-template-columns: minmax(0, 1fr); }
  .dsh-docker-search .dsh-docker-input { width: 100%; }
  .dsh-docker-search { flex: 1; }
  .dsh-docker-truncate { max-width: 200px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-docker-spinner, .dsh-docker-skel-line, .dsh-docker-toast { animation: none; }
}
`

export function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-container'
  tag.dataset.pluginCss = STYLE_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
}
