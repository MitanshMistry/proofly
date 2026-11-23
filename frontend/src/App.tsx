import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, Building2, Clock3, LayoutDashboard, Plus, Search, Settings,
  ShieldCheck, Upload, WalletCards, X
} from "lucide-react";
import {
  createProject, createReceipt, createWarrantyReminder, deleteAccount,
  deleteAllReceipts, deletePurchaseDocument, deleteReceipt, getAccount, getDuplicates,
  listHistory, listMerchants, listProjects, listPurchaseDocuments,
  listReceipts, listWarrantyReminders, login, loginDemo, logout,
  register, Receipt, updateReceipt, uploadPurchaseDocument, uploadReceipt
} from "./api";
import { demoPurchases } from "./demoData";
import { recognize } from "tesseract.js";

const navItems = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Purchases", icon: WalletCards },
  { name: "Warranty", icon: ShieldCheck },
  { name: "Stores", icon: Building2 },
  { name: "Collections", icon: Archive },
  { name: "History", icon: Clock3 },
  { name: "Settings", icon: Settings }
] as const;

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const formatDate = (value: string | null) => {
  if (!value) return "Date unknown";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "Date unknown"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

export function App() {
  if (import.meta.env.VITE_STATIC_DEMO === "true" || __GITHUB_PAGES__) return <StaticDemoApp />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [view, setView] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [warrantyFilter, setWarrantyFilter] = useState("All");
  const [sort, setSort] = useState("Newest purchase");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Receipt | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const accountQuery = useQuery({ queryKey: ["account"], queryFn: getAccount, retry: false });
  const receiptsQuery = useQuery({
    queryKey: ["receipts"],
    queryFn: () => listReceipts(),
    enabled: accountQuery.isSuccess
  });

  const purchases = useMemo(() => {
    const text = query.trim().toLowerCase();
    const matching = (receiptsQuery.data ?? []).filter((purchase) => {
      const searchable = [
        purchase.merchantName, purchase.category, purchase.status,
        purchase.receiptNumber, purchase.productName, purchase.brand,
        purchase.modelNumber, purchase.serialNumber, purchase.sku
      ].join(" ").toLowerCase();
      if (text && !searchable.includes(text)) return false;

      const status = purchaseWarrantyStatus(purchase);
      if (warrantyFilter !== "All" && status !== warrantyFilter) return false;
      return true;
    });

    return [...matching].sort((a, b) => {
      if (sort === "Oldest purchase") return (a.purchasedAt ?? "").localeCompare(b.purchasedAt ?? "");
      if (sort === "Warranty ending soon") {
        return (a.warrantyEndAt ?? "9999-12-31").localeCompare(b.warrantyEndAt ?? "9999-12-31");
      }
      if (sort === "Recently edited") return b.id.localeCompare(a.id);
      return (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? "");
    });
  }, [receiptsQuery.data, query, sort, warrantyFilter]);

  if (accountQuery.isLoading) return <AuthScreen loading />;
  if (accountQuery.isError && accountQuery.error instanceof Error && accountQuery.error.message !== "UNAUTHENTICATED") {
    return (
      <main className="auth-page">
        <section className="auth-card auth-loading">
          <strong>Could not open your archive</strong>
          <p className="muted">Check that the app and API are running, then try again.</p>
          <button className="primary" onClick={() => accountQuery.refetch()}>Try again</button>
        </section>
      </main>
    );
  }
  if (!accountQuery.isSuccess) {
    return <AuthGate onAuthenticated={() => accountQuery.refetch()} />;
  }

  const account = accountQuery.data;
  const initials = account.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => setView("Dashboard")} aria-label="Proofly dashboard">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M16 3.5l9 3.7v6.9c0 6.1-3.7 11.4-9 14.4-5.3-3-9-8.3-9-14.4V7.2l9-3.7z" fill="none" stroke="currentColor" strokeWidth="2"/>
              <path d="M11.3 16.2l3.2 3.2 6.7-7.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span><span className="brand-word">Proofly</span>
        </button>
        <div className="workspace">
          <span className="avatar">{initials}</span>
          <span><strong>{account.displayName}</strong><small>Personal vault</small></span>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Vault</p>
          {navItems.slice(0, 6).map(({ name, icon: Icon }) => (
            <button key={name} className={view === name ? "nav-item active" : "nav-item"} onClick={() => {
              setView(name);
              setMobileMenuOpen(false);
            }}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
              {name === "Purchases" && <span className="nav-count">{receiptsQuery.data?.length ?? 0}</span>}
            </button>
          ))}
          <p className="nav-label manage-label">Manage</p>
          {navItems.slice(6).map(({ name, icon: Icon }) => (
            <button key={name} className={view === name ? "nav-item active" : "nav-item"} onClick={() => {
              setView(name);
              setMobileMenuOpen(false);
            }}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="privacy-card"><ShieldIcon /><div><strong>Private evidence vault</strong><small>Purchases and documents stay owned by you</small></div></div>
          <button className="account-menu" onClick={async () => { await logout(); accountQuery.refetch(); }}>
            <span className="avatar small">{initials}</span><span><strong>{account.displayName}</strong><small>{account.email}</small></span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">☰</button>
          <label className="global-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store, invoice, model, serial, or SKU..." />
          </label>
          <span className="top-avatar">{initials}</span>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{view === "Dashboard" ? "Evidence overview" : "Personal vault"}</p>
              <h1>{view}</h1>
              <p className="muted">{getViewCopy(view)}</p>
            </div>
            <button className="primary upload-desktop upload-purchase-button" onClick={() => setUploadOpen(true)}><Plus size={17} /> Add purchase</button>
          </div>

          {view === "Dashboard" && (
            <DashboardView purchases={receiptsQuery.data ?? []} onOpenPurchase={setSelectedPurchase} onUpload={() => setUploadOpen(true)} />
          )}
          {(view === "Purchases" || view === "Warranty") && (
            <PurchaseView
              view={view}
              purchases={purchases}
              loading={receiptsQuery.isLoading}
              error={receiptsQuery.isError}
              query={query}
              sort={sort}
              setSort={setSort}
              warrantyFilter={warrantyFilter}
              setWarrantyFilter={setWarrantyFilter}
              retry={() => receiptsQuery.refetch()}
              onOpen={setSelectedPurchase}
            />
          )}
          {!["Dashboard", "Purchases", "Warranty"].includes(view) && <OrganizationView view={view} />}
        </div>
      </main>

      <button className="mobile-upload upload-purchase-button" onClick={() => setUploadOpen(true)}><Plus size={18} /> Add purchase</button>
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
      {selectedPurchase && <PurchaseDetail purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />}
    </div>
  );
}

function ShieldIcon() {
  return <ShieldCheck size={18} />;
}

function StaticDemoApp() {
  const [view, setView] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [warrantyFilter, setWarrantyFilter] = useState("All");
  const [sort, setSort] = useState("Newest purchase");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const purchases = useMemo(() => {
    const text = query.trim().toLowerCase();
    const matching = demoPurchases.filter((purchase) => {
      const searchable = [
        purchase.merchantName, purchase.category, purchase.status,
        purchase.receiptNumber, purchase.productName, purchase.brand,
        purchase.modelNumber, purchase.serialNumber, purchase.sku
      ].join(" ").toLowerCase();
      if (text && !searchable.includes(text)) return false;
      if (view !== "Dashboard" && warrantyFilter !== "All" &&
        purchaseWarrantyStatus(purchase) !== warrantyFilter) return false;
      return true;
    });

    return [...matching].sort((a, b) => {
      if (sort === "Oldest purchase") return (a.purchasedAt ?? "").localeCompare(b.purchasedAt ?? "");
      if (sort === "Warranty ending soon") {
        return (a.warrantyEndAt ?? "9999-12-31").localeCompare(b.warrantyEndAt ?? "9999-12-31");
      }
      if (sort === "Recently edited") return b.id.localeCompare(a.id);
      return (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? "");
    });
  }, [query, sort, view, warrantyFilter]);

  return (
    <div className="shell">
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => setView("Dashboard")} aria-label="Proofly dashboard">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M16 3.5l9 3.7v6.9c0 6.1-3.7 11.4-9 14.4-5.3-3-9-8.3-9-14.4V7.2l9-3.7z" fill="none" stroke="currentColor" strokeWidth="2"/>
              <path d="M11.3 16.2l3.2 3.2 6.7-7.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span><span className="brand-word">Proofly</span>
        </button>
        <div className="workspace">
          <span className="avatar">SD</span>
          <span><strong>Sample vault</strong><small>Read-only demo</small></span>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Sample vault</p>
          {navItems.slice(0, 3).map(({ name, icon: Icon }) => (
            <button key={name} className={view === name ? "nav-item active" : "nav-item"} onClick={() => {
              setView(name);
              setMobileMenuOpen(false);
            }}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
              {name === "Purchases" && <span className="nav-count">{demoPurchases.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="privacy-card"><ShieldIcon /><div><strong>Fictional sample data</strong><small>Static, read-only demonstration</small></div></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">☰</button>
          <label className="global-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store, invoice, model, serial, or SKU..." />
          </label>
          <span className="top-avatar">SD</span>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Fictional sample data · Read-only</p>
              <h1>{view}</h1>
              <p className="muted">{view === "Dashboard"
                ? "Explore sample purchases, warranty coverage, and records needing attention."
                : getViewCopy(view)}</p>
            </div>
          </div>

          {view === "Dashboard" && (
            <DashboardView purchases={demoPurchases} readOnly />
          )}
          {(view === "Purchases" || view === "Warranty") && (
            <PurchaseView
              view={view}
              purchases={purchases}
              loading={false}
              error={false}
              query={query}
              sort={sort}
              setSort={setSort}
              warrantyFilter={warrantyFilter}
              setWarrantyFilter={setWarrantyFilter}
              readOnly
            />
          )}
        </div>
      </main>
    </div>
  );
}

function getViewCopy(view: string) {
  const copy: Record<string, string> = {
    Dashboard: "Protect purchases and see exactly what needs attention.",
    Purchases: "Every invoice, product identity, and document in one record.",
    Warranty: "Active coverage, deadlines, missing details, and expiring protection.",
    Stores: "Find purchases by where they were bought.",
    Collections: "Group purchases around home, vehicle, office, workshop, or travel.",
    History: "A chronological record of uploads and changes.",
    Settings: "Privacy, exports, reminders, and account data."
  };
  return copy[view] ?? "Keep proof of purchase close.";
}

function purchaseWarrantyStatus(purchase: Receipt) {
  if (purchase.warrantyProvider === "NONE") return "NO_WARRANTY";
  if (!purchase.warrantyConfirmed || !purchase.warrantyEndAt) return "UNKNOWN";
  const end = new Date(`${purchase.warrantyEndAt}T23:59:59`);
  const now = new Date();
  if (end.getTime() < now.getTime()) return "EXPIRED";
  const days = (end.getTime() - now.getTime()) / 86400000;
  if (days <= 30) return "EXPIRING_SOON";
  return "ACTIVE";
}

function warrantyLabel(status: string) {
  return {
    ACTIVE: "Active",
    EXPIRING_SOON: "Expiring soon",
    EXPIRED: "Expired",
    UNKNOWN: "Warranty unknown",
    NO_WARRANTY: "No warranty"
  }[status] ?? "Unknown";
}

function DashboardView({ purchases, onOpenPurchase, onUpload, readOnly = false }: {
  purchases: Receipt[];
  onOpenPurchase?: (purchase: Receipt) => void;
  onUpload?: () => void;
  readOnly?: boolean;
}) {
  const active = purchases.filter((item) => purchaseWarrantyStatus(item) === "ACTIVE").length;
  const expiring = purchases.filter((item) => purchaseWarrantyStatus(item) === "EXPIRING_SOON").length;
  const expired = purchases.filter((item) => purchaseWarrantyStatus(item) === "EXPIRED").length;
  const unknown = purchases.filter((item) => purchaseWarrantyStatus(item) === "UNKNOWN").length;
  const recent = [...purchases].sort((a, b) => (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? "")).slice(0, 7);

  return (
    <>
      <div className="warranty-stats">
        <article className="warranty-stat active"><span className="stat-symbol"><ShieldCheck size={18} /></span><div><small>Active warranties</small><strong>{active}</strong></div></article>
        <article className="warranty-stat expiring"><span className="stat-symbol">30</span><div><small>Expiring soon</small><strong>{expiring}</strong></div></article>
        <article className="warranty-stat expired"><span className="stat-symbol">!</span><div><small>Expired</small><strong>{expired}</strong></div></article>
        <article className="warranty-stat unknown"><span className="stat-symbol">?</span><div><small>Details missing</small><strong>{unknown}</strong></div></article>
      </div>

      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="panel-header">
            <div><h2>Recent purchases</h2><p>Newest purchase date first</p></div>
            {onUpload && <button className="panel-action upload-purchase-button" onClick={onUpload}><Plus size={15} /> Add purchase</button>}
          </div>
          {recent.length ? recent.map((purchase) => (
            <PurchaseRow key={purchase.id} purchase={purchase} onOpen={onOpenPurchase} />
          )) : (
            <div className="state-card">
              <span className="state-icon"><Upload size={22} /></span>
              <strong>No purchases yet</strong>
              <p>Add a purchase to start your proof-of-purchase vault.</p>
              {onUpload && <button className="primary" onClick={onUpload}>Upload first purchase</button>}
            </div>
          )}
        </section>
        <section className="panel attention-panel">
          <div className="panel-header"><div><h2>Needs attention</h2><p>Incomplete warranty records</p></div></div>
          {[...purchases].filter((item) => purchaseWarrantyStatus(item) === "UNKNOWN").slice(0, 5).map((purchase) => {
            const content = <>
              <span className="attention-icon">?</span>
              <span><strong>{purchase.productName || purchase.merchantName}</strong><small>Add warranty or product details</small></span>
              {!readOnly && <span>›</span>}
            </>;
            return onOpenPurchase
              ? <button className="attention-row" key={purchase.id} onClick={() => onOpenPurchase(purchase)}>{content}</button>
              : <div className="attention-row" key={purchase.id}>{content}</div>;
          })}
          {!unknown && <p className="muted no-attention">No warranty details need review.</p>}
        </section>
      </div>
    </>
  );
}

function PurchaseView({ view, purchases, loading, error, query, sort, setSort, warrantyFilter, setWarrantyFilter, retry, onOpen, readOnly = false }: {
  view: string;
  purchases: Receipt[];
  loading: boolean;
  error: boolean;
  query: string;
  sort: string;
  setSort: (value: string) => void;
  warrantyFilter: string;
  setWarrantyFilter: (value: string) => void;
  retry?: () => void;
  onOpen?: (purchase: Receipt) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="panel purchases-panel">
      {view === "Warranty" && (
        <div className="warranty-filter-strip" role="tablist" aria-label="Warranty status">
          {[["All","All"],["ACTIVE","Active"],["EXPIRING_SOON","Expiring"],["EXPIRED","Expired"],["UNKNOWN","Missing"]].map(([value,label]) => (
            <button key={value} role="tab" aria-selected={warrantyFilter === value} className={warrantyFilter === value ? "active" : ""} onClick={() => setWarrantyFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="panel-header">
        <div><h2>{view === "Warranty" ? "Warranty coverage" : "All purchases"}</h2><p>{purchases.length} purchase{purchases.length === 1 ? "" : "s"} found</p></div>
        <div className="toolbar">
          <select value={warrantyFilter} onChange={(event) => setWarrantyFilter(event.target.value)} aria-label="Filter by warranty status">
            <option>All</option><option>ACTIVE</option><option>EXPIRING_SOON</option><option>EXPIRED</option><option>UNKNOWN</option><option>NO_WARRANTY</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort purchases">
            <option>Newest purchase</option><option>Oldest purchase</option><option>Warranty ending soon</option>
            {!readOnly && <option>Recently edited</option>}
          </select>
        </div>
      </div>
      {loading && <div className="state-card"><span className="spinner" /><strong>Loading purchases</strong></div>}
      {error && <div className="state-card error-state"><strong>Could not load purchases</strong>{retry && <button className="secondary" onClick={retry}>Try again</button>}</div>}
      {!loading && !error && !purchases.length && (
        <div className="state-card">
          <span className="state-icon"><Search size={22} /></span>
          <strong>{query || warrantyFilter !== "All" ? "No matching purchases" : "No purchases saved"}</strong>
          <p>{query || warrantyFilter !== "All" ? "Change the search or warranty filter." : "Upload a purchase to protect it."}</p>
        </div>
      )}
      {!loading && !error && purchases.map((purchase) => <PurchaseRow key={purchase.id} purchase={purchase} onOpen={onOpen} />)}
    </section>
  );
}

function PurchaseRow({ purchase, onOpen }: { purchase: Receipt; onOpen?: (purchase: Receipt) => void }) {
  const status = purchaseWarrantyStatus(purchase);
  const identity = purchase.productName || purchase.brand || purchase.merchantName;
  const identifiers = [purchase.modelNumber, purchase.serialNumber, purchase.sku].filter(Boolean).join(" · ");
  const content = <>
      <span className="purchase-thumb">▣</span>
      <span className="purchase-main">
        <strong>{identity}</strong>
        <small>{purchase.merchantName} · {formatDate(purchase.purchasedAt)}{identifiers ? ` · ${identifiers}` : ""}</small>
      </span>
      <span className="purchase-warranty">
        <span className={`warranty-pill ${status.toLowerCase()}`}>{warrantyLabel(status)}</span>
        {purchase.warrantyEndAt && <small>Ends {formatDate(purchase.warrantyEndAt)}</small>}
      </span>
      {onOpen && <span className="row-arrow">›</span>}
    </>;
  return onOpen
    ? <button className="purchase-row" onClick={() => onOpen(purchase)}>{content}</button>
    : <div className="purchase-row">{content}</div>;
}

function AuthScreen({ loading }: { loading?: boolean }) {
  if (!loading) return null;
  return <main className="auth-page"><section className="auth-card auth-loading"><span className="spinner" /><strong>Opening your vault</strong></section></main>;
}

function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      if (mode === "register") await register(email, displayName, password);
      else await login(email, password);
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not continue");
    } finally {
      setPending(false);
    }
  }

  async function continueAsDemo() {
    setPending(true);
    setError("");
    try {
      await loginDemo();
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open demo");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M16 3.5l9 3.7v6.9c0 6.1-3.7 11.4-9 14.4-5.3-3-9-8.3-9-14.4V7.2l9-3.7z" fill="none" stroke="currentColor" strokeWidth="2"/>
              <path d="M11.3 16.2l3.2 3.2 6.7-7.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span><strong className="brand-word">Proofly</strong>
        </span>
        <div className="auth-copy">
          <p className="eyebrow">Private proof-of-purchase vault</p>
          <h1>{mode === "login" ? "Welcome back" : "Create your vault"}</h1>
          <p>{mode === "login" ? "Open your purchases and warranty evidence." : "Keep proof of purchase and product protection together."}</p>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="Alex Morgan" required /></label>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary auth-submit" disabled={pending}>{pending ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "New to Proofly? Create an account" : "Already have an account? Sign in"}
        </button>
        <button className="demo-button" onClick={continueAsDemo} disabled={pending}>Continue as demo</button>
      </section>
    </main>
  );
}

function PurchaseDetail({ purchase, onClose }: { purchase: Receipt; onClose: () => void }) {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const documents = useQuery({ queryKey: ["purchase-documents", purchase.id], queryFn: () => listPurchaseDocuments(purchase.id) });
  const duplicates = useQuery({ queryKey: ["duplicates", purchase.id], queryFn: () => getDuplicates(purchase.id) });
  const [tab, setTab] = useState<"Purchase" | "Warranty" | "Documents">("Purchase");
  const [store, setStore] = useState(purchase.merchantName);
  const [purchaseDate, setPurchaseDate] = useState(purchase.purchasedAt);
  const [total, setTotal] = useState(String(purchase.total));
  const [category, setCategory] = useState(purchase.category);
  const [collectionId, setCollectionId] = useState(purchase.projectId ?? "");
  const [receiptNumber, setReceiptNumber] = useState(purchase.receiptNumber ?? "");
  const [productName, setProductName] = useState(purchase.productName ?? "");
  const [brand, setBrand] = useState(purchase.brand ?? "");
  const [modelNumber, setModelNumber] = useState(purchase.modelNumber ?? "");
  const [serialNumber, setSerialNumber] = useState(purchase.serialNumber ?? "");
  const [sku, setSku] = useState(purchase.sku ?? "");
  const [provider, setProvider] = useState(purchase.warrantyProvider ?? "UNKNOWN");
  const [duration, setDuration] = useState(purchase.warrantyDurationMonths?.toString() ?? "");
  const [warrantyStart, setWarrantyStart] = useState(purchase.warrantyStartAt ?? purchase.purchasedAt);
  const [warrantyEnd, setWarrantyEnd] = useState(purchase.warrantyEndAt ?? "");
  const [returnEnd, setReturnEnd] = useState(purchase.returnWindowEndAt ?? "");
  const [confirmed, setConfirmed] = useState(purchase.warrantyConfirmed);
  const [documentType, setDocumentType] = useState("RECEIPT");
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: () => updateReceipt(purchase.id, {
      merchantName: store,
      purchasedAt: purchaseDate,
      total: Number(total),
      category,
      projectId: collectionId || undefined,
      receiptNumber,
      productName,
      brand,
      modelNumber,
      serialNumber,
      sku,
      warrantyProvider: provider,
      warrantyDurationMonths: duration ? Number(duration) : undefined,
      warrantyStartAt: warrantyStart || undefined,
      warrantyEndAt: warrantyEnd || undefined,
      returnWindowEndAt: returnEnd || undefined,
      warrantyConfirmed: confirmed
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: () => setError("Could not save this purchase.")
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteReceipt(purchase.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      onClose();
    }
  });

  async function uploadDocument(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      await uploadPurchaseDocument(purchase.id, file, documentType);
      queryClient.invalidateQueries({ queryKey: ["purchase-documents", purchase.id] });
    } catch {
      setError("Could not upload that supporting document.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="purchase-detail-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-title">
        <div className="detail-header">
          <div><p className="eyebrow">Purchase record</p><h2 id="purchase-title">{productName || brand || store}</h2></div>
          <button className="modal-close" onClick={onClose} aria-label="Close purchase"><X size={18} /></button>
        </div>
        <div className="detail-layout">
          <aside className="detail-evidence">
            <img src={`/api/receipts/${purchase.id}/image`} alt={`Purchase evidence for ${store}`} onError={(event) => { event.currentTarget.style.display = "none"; }} />
            <div className="evidence-caption"><strong>Original evidence</strong><span>Tap an image to inspect evidence</span></div>
            {documents.data?.map((document) => (
              <div key={document.id} className="document-row">
                <a className="document-link" href={`/api/purchases/${purchase.id}/documents/${document.id}`} target="_blank" rel="noreferrer">
                  <span>{document.documentType.replaceAll("_", " ")}</span><small>{Math.max(1, Math.round(document.sizeBytes / 1024))} KB</small>
                </a>
                <button type="button" className="document-delete" aria-label={`Delete ${document.documentType}`} onClick={async () => {
                  if (!window.confirm("Delete this supporting document?")) return;
                  await deletePurchaseDocument(purchase.id, document.id);
                  queryClient.invalidateQueries({ queryKey: ["purchase-documents", purchase.id] });
                }}>Delete</button>
              </div>
            ))}
          </aside>
          <div className="detail-content">
            <div className="detail-tabs" role="tablist">
              {(["Purchase", "Warranty", "Documents"] as const).map((item) => (
                <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
              ))}
            </div>

            {tab === "Purchase" && (
              <div className="detail-fields">
                <label>Store<input value={store} onChange={(event) => setStore(event.target.value)} /></label>
                <div className="form-grid">
                  <label>Purchase date<input type="date" value={purchaseDate ?? ""} onChange={(event) => setPurchaseDate(event.target.value)} /></label>
                  <label>Total<input type="number" min="0" step="0.01" value={total} onChange={(event) => setTotal(event.target.value)} /></label>
                </div>
                <label>Receipt number<input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} /></label>
                <div className="form-grid">
                  <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} /></label>
                  <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
                </div>
                <div className="form-grid">
                  <label>Model number<input value={modelNumber} onChange={(event) => setModelNumber(event.target.value)} /></label>
                  <label>Serial number<input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
                </div>
                <div className="form-grid">
                  <label>SKU<input value={sku} onChange={(event) => setSku(event.target.value)} /></label>
                  <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Electronics</option><option>Computer</option><option>Appliance</option><option>Automotive</option><option>Tools</option><option>Furniture</option><option>Home</option><option>Health</option><option>Other</option></select></label>
                </div>
                <label>Collection<select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">No collection</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              </div>
            )}

            {tab === "Warranty" && (
              <div className="detail-fields">
                <div className={`warranty-summary ${purchaseWarrantyStatus(purchase).toLowerCase()}`}><span>{warrantyLabel(purchaseWarrantyStatus(purchase))}</span><strong>{warrantyEnd ? formatDate(warrantyEnd) : "End date unknown"}</strong></div>
                <label>Warranty provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="UNKNOWN">Unknown</option><option value="MANUFACTURER">Manufacturer</option><option value="RETAILER">Retailer/store</option><option value="EXTENDED">Extended warranty</option><option value="NONE">No warranty</option></select></label>
                <div className="form-grid">
                  <label>Warranty duration (months)<input type="number" min="0" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
                  <label>Warranty start<input type="date" value={warrantyStart ?? ""} onChange={(event) => setWarrantyStart(event.target.value)} /></label>
                </div>
                <div className="form-grid">
                  <label>Warranty end<input type="date" value={warrantyEnd} onChange={(event) => setWarrantyEnd(event.target.value)} /></label>
                  <label>Return window end<input type="date" value={returnEnd} onChange={(event) => setReturnEnd(event.target.value)} /></label>
                </div>
                <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirmed this warranty information</label>
                {warrantyEnd && <div className="reminder-actions">
                  {[{days:90,label:"90-day"},{days:30,label:"30-day"},{days:7,label:"7-day"}].map((reminder) => (
                    <button key={reminder.days} type="button" className="secondary" onClick={async () => {
                      try {
                        const date = new Date(`${warrantyEnd}T12:00:00`);
                        date.setDate(date.getDate() - reminder.days);
                        await createWarrantyReminder(purchase.id, date.toISOString().slice(0,10), `${reminder.label} warranty reminder`);
                        setError("");
                      } catch {
                        setError("Could not create reminder.");
                      }
                    }}>{reminder.label} reminder</button>
                  ))}
                  <button type="button" className="secondary" onClick={async () => {
                    try {
                      await createWarrantyReminder(purchase.id, warrantyEnd, "Warranty end reminder");
                      setError("");
                    } catch {
                      setError("Could not create reminder.");
                    }
                  }}>On expiry</button>
                </div>}
              </div>
            )}

            {tab === "Documents" && (
              <div className="detail-fields">
                <label>Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="RECEIPT">Receipt</option><option value="BOX">Box label</option><option value="SERIAL_PLATE">Serial plate</option><option value="PRODUCT">Product photo</option><option value="MANUAL">Manual</option><option value="WARRANTY">Warranty document</option><option value="REPAIR">Repair ticket</option><option value="RMA">RMA/return</option></select></label>
                <label className="document-upload"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => uploadDocument(event.target.files?.[0])} /><span><Upload size={20} /><strong>Add supporting evidence</strong><small>Photo up to 10 MB</small></span></label>
              </div>
            )}

            {(duplicates.data?.length ?? 0) > 0 && <div className="duplicate-warning"><strong>Possible duplicate</strong><p>Review the matching purchase before saving another copy.</p></div>}
            {error && <p className="form-error">{error}</p>}
          </div>
        </div>
        <div className="detail-actions">
          <button type="button" className="danger-button" onClick={() => { if (window.confirm("Delete this purchase and its evidence?")) deleteMutation.mutate(); }}>Delete purchase</button>
          <button type="button" className="primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Saving..." : "Save and confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function OrganizationView({ view }: { view: string }) {
  const queryClient = useQueryClient();
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: listMerchants });
  const collections = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const history = useQuery({ queryKey: ["history"], queryFn: listHistory });
  const reminders = useQuery({ queryKey: ["reminders"], queryFn: listWarrantyReminders });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const createCollection = useMutation({
    mutationFn: () => createProject(name, "blue"),
    onSuccess: () => {
      setName("");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  if (view === "Stores") {
    return (
      <section className="panel organization-panel">
        <div className="panel-header"><div><h2>Stores</h2><p>Purchases grouped by where they were bought</p></div></div>
        {merchants.isLoading && <div className="state-card"><span className="spinner" /><strong>Loading stores</strong></div>}
        {merchants.isError && <div className="state-card error-state"><strong>Could not load stores</strong></div>}
        {!merchants.isLoading && !merchants.isError && (merchants.data?.length ? merchants.data.map((store) => (
          <div className="organization-row" key={store.name}>
            <span className="receipt-icon">{store.name.slice(0, 2).toUpperCase()}</span>
            <span><strong>{store.name}</strong><small>{store.receiptCount} purchase{store.receiptCount === 1 ? "" : "s"} · Latest {store.latest ? formatDate(store.latest) : "unknown"}</small></span>
            <span className="organization-meta">View purchases</span>
          </div>
        )) : <div className="state-card"><span className="state-icon"><Building2 size={22} /></span><strong>No stores yet</strong><p>Save a purchase to create your first store record.</p></div>)}
      </section>
    );
  }

  if (view === "Collections") {
    return (
      <section className="panel organization-panel">
        <div className="panel-header"><div><h2>Collections</h2><p>Group purchases around home, vehicle, office, workshop, or travel</p></div><button className="secondary" onClick={() => setCreating(true)}><Plus size={15} /> New collection</button></div>
        {creating && <form className="inline-project-form" onSubmit={(event) => { event.preventDefault(); createCollection.mutate(); }}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" required />
          <button className="primary" disabled={createCollection.isPending || !name.trim()}>{createCollection.isPending ? "Creating..." : "Create"}</button>
          <button type="button" className="secondary" onClick={() => setCreating(false)}>Cancel</button>
        </form>}
        {collections.isLoading && <div className="state-card"><span className="spinner" /><strong>Loading collections</strong></div>}
        {!collections.isLoading && (collections.data?.length ? collections.data.map((collection) => (
          <div className="organization-row" key={collection.id}>
            <span className="project-icon"><Archive size={18} /></span>
            <span><strong>{collection.name}</strong><small>{collection.receiptCount} purchase{collection.receiptCount === 1 ? "" : "s"}</small></span>
            <span className="organization-meta">{collection.receiptCount} purchase{collection.receiptCount === 1 ? "" : "s"}</span>
          </div>
        )) : <div className="state-card"><span className="state-icon"><Archive size={22} /></span><strong>No collections yet</strong><p>Create a collection for a vehicle, room, office, or other purpose.</p></div>)}
      </section>
    );
  }

  if (view === "History") {
    return (
      <section className="panel organization-panel">
        <div className="panel-header"><div><h2>Activity history</h2><p>Newest purchase activity first</p></div></div>
        {history.isLoading && <div className="state-card"><span className="spinner" /><strong>Loading history</strong></div>}
        {!history.isLoading && (history.data?.length ? history.data.map((item) => (
          <div className="history-row" key={`${item.receiptId}-${item.createdAt}`}><span className="history-dot">◆</span><span><strong>{item.description}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span></div>
        )) : <div className="state-card"><span className="state-icon"><Clock3 size={22} /></span><strong>No activity yet</strong><p>Saved purchases will appear here.</p></div>)}
      </section>
    );
  }

  return (
    <section className="panel organization-panel">
      <div className="panel-header"><div><h2>Account and privacy</h2><p>Control your vault and evidence</p></div></div>
      <div className="settings-row"><span><strong>Export purchases</strong><small>Download purchase metadata as CSV</small></span><a className="secondary" href="/api/receipts/export.csv">Export CSV</a></div>
      <div className="settings-row"><span><strong>Warranty calendar</strong><small>{reminders.data?.length ?? 0} saved reminder(s)</small></span><a className="secondary" href="/api/reminders/calendar.ics">Download calendar</a></div>
      <div className="settings-row"><span><strong>Delete purchase data</strong><small>Permanently remove purchases and evidence</small></span><button className="danger-button" onClick={async () => { if (window.confirm("Permanently delete every purchase and document?")) { await deleteAllReceipts(); window.location.reload(); } }}>Delete data</button></div>
      <div className="settings-row"><span><strong>Delete account</strong><small>Permanently remove account and vault data</small></span><button className="danger-button" onClick={async () => { if (window.confirm("Permanently delete this account and all evidence?")) { await deleteAccount(); window.location.reload(); } }}>Delete account</button></div>
    </section>
  );
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [store, setStore] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [total, setTotal] = useState("");
  const [category, setCategory] = useState("Electronics");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [sku, setSku] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [ocrStatus, setOcrStatus] = useState("");
  const [error, setError] = useState("");
  const [evidenceType, setEvidenceType] = useState("RECEIPT");
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const saveMutation = useMutation({
    mutationFn: (payload: { merchantName: string; purchasedAt: string; total: number; category: string; receiptNumber?: string; productName?: string; brand?: string; modelNumber?: string; serialNumber?: string; sku?: string }) =>
      file ? uploadReceipt(file, payload) : createReceipt(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      onClose();
    },
    onError: () => setError("Could not save this purchase.")
  });

  async function chooseFile(selected: File | undefined) {
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, WEBP, HEIC, or HEIF image.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("Choose an image smaller than 10 MB.");
      return;
    }
    setError("");
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setOcrStatus("Reading purchase evidence...");
    try {
      const result = await recognize(selected, "eng");
      const text = result.data.text.trim();
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines[0] && !store) setStore(lines[0].slice(0, 120));

      const dateMatch = text.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/. -]\d{1,2}[/. -]20\d{2})\b/);
      if (dateMatch) {
        const normalized = dateMatch[1].replace(/[/.]/g, "-").replace(/ /g, "-");
        if (/^\d{4}-\d/.test(normalized)) {
          setPurchaseDate(normalized.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) =>
            `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`));
        }
      }

      const totalMatch = text.match(/(?:grand\s*total|amount\s*due|total)\s*[:$]?\s*\$?\s*(\d+[,.]\d{2})/i);
      if (totalMatch) setTotal(totalMatch[1].replace(",", "."));

      const receiptMatch = text.match(/(?:receipt|transaction|invoice|order)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
      if (receiptMatch) setReceiptNumber(receiptMatch[1]);
      const modelMatch = text.match(/(?:model|model\s*(?:no\.?|number)|m\/n)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i);
      if (modelMatch) setModelNumber(modelMatch[1]);
      const serialMatch = text.match(/(?:serial|serial\s*(?:no\.?|number)|s\/n)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{4,})/i);
      if (serialMatch) setSerialNumber(serialMatch[1]);

      setOcrStatus(result.data.confidence < 70
        ? `OCR is uncertain (${Math.round(result.data.confidence)}%). Review every important field.`
        : `OCR complete (${Math.round(result.data.confidence)}% confidence). Review important fields.`);
    } catch {
      setOcrStatus("OCR could not read this evidence. Enter the details manually.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const amount = Number(total);
    if (!store.trim() || !purchaseDate || !Number.isFinite(amount) || amount < 0) {
      setError("Add a store, purchase date, and valid total.");
      return;
    }
    saveMutation.mutate({
      merchantName: store.trim(),
      purchasedAt: purchaseDate,
      total: amount,
      category,
      receiptNumber,
      productName,
      brand,
      modelNumber,
      serialNumber,
      sku
    });
  }

  function removeEvidence() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
    setFile(null);
    setOcrStatus("");
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <button className="modal-close" onClick={onClose} aria-label="Close upload"><X size={18} /></button>
        <span className="modal-icon"><Upload size={23} /></span>
        <p className="eyebrow">Add proof of purchase</p>
        <h2 id="upload-title">Upload purchase evidence</h2>
        <p className="modal-copy">Add the invoice or receipt first. Then confirm the product and warranty details.</p>
        <form onSubmit={submit}>
          <div className="evidence-step-heading">
            <div><strong>Purchase evidence</strong><small>Receipt, invoice, box label, or serial plate</small></div>
            <select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} aria-label="Evidence type">
              <option value="RECEIPT">Receipt</option>
              <option value="INVOICE">Invoice</option>
              <option value="BOX">Box label</option>
              <option value="SERIAL_PLATE">Serial plate</option>
              <option value="PRODUCT">Product photo</option>
            </select>
          </div>
          <div
            className={`evidence-upload ${preview ? "has-preview" : ""} ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <input id="purchase-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => chooseFile(event.target.files?.[0])} />
            <input id="purchase-camera" type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} />
            {preview ? (
              <div className="evidence-preview">
                <img src={preview} alt="Purchase evidence preview" />
                <div className="evidence-preview-actions">
                  <span title={file?.name}>{file?.name ?? "Selected evidence"}</span>
                  <button type="button" onClick={removeEvidence}>Remove</button>
                </div>
              </div>
            ) : (
              <div className="evidence-placeholder">
                <span className="evidence-icon"><Upload size={22} /></span>
                <strong>Add a clear photo of the evidence</strong>
                <small>JPG, PNG, WEBP, HEIC or HEIF · up to 10 MB</small>
                <div className="evidence-actions">
                  <label htmlFor="purchase-camera" className="secondary evidence-action">Take photo</label>
                  <label htmlFor="purchase-file" className="primary evidence-action">Choose file</label>
                </div>
              </div>
            )}
          </div>
          {ocrStatus && <p className="ocr-status">{ocrStatus}</p>}
          <div className="form-grid">
            <label>Store<input value={store} onChange={(event) => setStore(event.target.value)} placeholder="Example: Canadian Tire" /></label>
            <label>Purchase date<input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Receipt number<input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} /></label>
            <label>Total<input type="number" min="0" step="0.01" value={total} onChange={(event) => setTotal(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Example: Circular saw" /></label>
            <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Model number<input value={modelNumber} onChange={(event) => setModelNumber(event.target.value)} /></label>
            <label>Serial number<input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
          </div>
          <label>SKU<input value={sku} onChange={(event) => setSku(event.target.value)} /></label>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Electronics</option><option>Computer</option><option>Appliance</option><option>Automotive</option><option>Tools</option><option>Furniture</option><option>Home</option><option>Health</option><option>Other</option></select></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary modal-submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : "Save purchase"}</button>
        </form>
      </div>
    </div>
  );
}
