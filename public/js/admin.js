/* VELUNE Studio — admin dashboard */
(() => {
  'use strict';

  // The admin page does not load the storefront bundle, so it keeps its own
  // photography check. Legacy .svg packshots are never shown here either.
  const isPhotoUrl = (value) => /\.(?:jpe?g|png|webp|avif)$/i.test(String(value || '').split('?')[0].split('#')[0]);

  const TOKEN_KEY = 'velune.admin.token';
  const STATUSES = ['Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  const PAYMENT_STATUSES = [
    'Awaiting Payment',
    'Proof submitted',
    'Paid',
    'Refunded',
    'Payment on delivery',
    'Cancelled — no payment due'
  ];

  // Mirrors STAFF_PERMISSIONS on the server. `chat`, `tickets` and `upload` are
  // the only keys a new employee account holds by default.
  const PERMISSION_KEYS = [
    'chat',
    'tickets',
    'upload',
    'moderate',
    'products',
    'inventory',
    'customers',
    'verification',
    'reports',
    'staff'
  ];
  const PERMISSION_LABELS = {
    chat: 'Live chat',
    tickets: 'Support tickets',
    upload: 'Image uploads',
    moderate: 'Delete messages',
    products: 'Products',
    inventory: 'Inventory',
    customers: 'Customers',
    verification: 'Verification',
    reports: 'Reports',
    staff: 'Team panel'
  };
  const SUPPORT_DEFAULT_PERMISSIONS = () => {
    const permissions = {};
    for (const key of PERMISSION_KEYS) permissions[key] = key === 'chat' || key === 'tickets' || key === 'upload';
    return permissions;
  };
  const DOC_STATUS = { accepted: 'Accepted', rejected: 'Rejected', pending: 'Pending' };
  const PRODUCT_PAGE_SIZE = 40;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    user: null,
    route: 'overview',
    overview: null,
    orders: null,
    products: null,
    categories: [],
    tickets: null,
    subscribers: null,
    customers: null,
    stores: null,
    integrations: null,
    integrationProviders: [],
    integrationJobs: [],
    integrationCatalog: null,
    settings: null,
    ticketFilter: 'open',
    staff: null,
    verification: null,
    verifyFilter: 'queue',
    verifyDetailId: '',
    report: null,
    reportRange: '30',
    reportRows: 40,
    expenses: null,
    delivery: null,
    deliveryFilter: 'all',
    deliveryAuto: false,
    deliveryTimer: null,
    productRows: 40
  };

  const els = {
    login: $('[data-login-view]'),
    dashboard: $('[data-dashboard]'),
    loginForm: $('[data-login-form]'),
    loginError: $('[data-login-error]'),
    loginSubmit: $('[data-login-submit]'),
    pageTitle: $('[data-page-title]'),
    date: $('[data-admin-date]'),
    sidebar: $('[data-sidebar]'),
    sidebarScrim: $('[data-sidebar-scrim]'),
    modal: $('[data-modal]'),
    modalTitle: $('[data-modal-title]'),
    modalBody: $('[data-modal-body]'),
    toast: $('[data-admin-toast]'),
    orderSearch: $('[data-order-search]'),
    orderStatus: $('[data-order-status]'),
    ordersTable: $('[data-orders-table]'),
    ordersCount: $('[data-orders-count]'),
    productSearch: $('[data-product-search]'),
    productCategory: $('[data-product-category]'),
    productsTable: $('[data-products-table]'),
    productsCount: $('[data-products-count]'),
    ticketsList: $('[data-tickets-list]'),
    ticketsCount: $('[data-tickets-count]'),
    subscribersTable: $('[data-subscribers-table]'),
    subscribersCount: $('[data-subscribers-count]'),
    subscriberSearch: $('[data-subscriber-search]'),
    customersTable: $('[data-customers-table]'),
    customersCount: $('[data-customers-count]'),
    customerSearch: $('[data-customer-search]'),
    storesTable: $('[data-stores-table]'),
    storesCount: $('[data-stores-count]'),
    storeSearch: $('[data-store-search]'),
    integrationsList: $('[data-integrations-list]'),
    integrationsCount: $('[data-integrations-count]'),
    integrationJobs: $('[data-integration-jobs]'),
    settingsForm: $('[data-settings-form]'),
    settingsError: $('[data-settings-error]'),
    paymentsGrid: $('[data-payments-grid]'),
    paymentsError: $('[data-payments-error]'),
    paymentsSave: $('[data-payments-save]'),
    paymentInstructions: $('[data-payment-instructions]'),
    orderPayment: $('[data-order-payment]'),
    lcLive: $('[data-lc-live]'),
    lcList: $('[data-lc-list]'),
    lcThread: $('[data-lc-thread]'),
    lcSearch: $('[data-lc-search]'),
    lcNavCount: $('[data-nav-chat-count]'),
    lcNotify: $('[data-lc-notify]'),
    categoriesList: $('[data-categories-list]'),
    categoriesCount: $('[data-categories-count]'),
    categoryForm: $('[data-category-form]'),
    categoryError: $('[data-category-error]'),
    staffTable: $('[data-staff-table]'),
    staffCount: $('[data-staff-count]'),
    staffSearch: $('[data-staff-search]'),
    verifyTable: $('[data-verify-table]'),
    verifyDetail: $('[data-verify-detail]'),
    verifyCount: $('[data-verify-count]'),
    verifySearch: $('[data-verify-search]'),
    verifyPolicyNote: $('[data-verify-policy-note]'),
    verifyNavCount: $('[data-nav-verification-count]'),
    reportTiles: $('[data-report-tiles]'),
    reportChart: $('[data-report-chart]'),
    reportProducts: $('[data-report-products]'),
    reportProductsMore: $('[data-report-products-more]'),
    reportPaymentMix: $('[data-report-paymentmix]'),
    reportRange: $('[data-report-range]'),
    reportWindow: $('[data-report-window]'),
    expensesTable: $('[data-expenses-table]'),
    expenseForm: $('[data-expense-form]'),
    expenseError: $('[data-expense-error]'),
    expenseNote: $('[data-expense-note]'),
    deliveryTable: $('[data-delivery-table]'),
    deliveryCount: $('[data-delivery-count]'),
    deliveryStatus: $('[data-delivery-status]'),
    deliverySearch: $('[data-delivery-search]'),
    deliveryAuto: $('[data-delivery-auto]'),
    deliveryNote: $('[data-delivery-note]'),
    deliveryNavCount: $('[data-nav-delivery-count]'),
    categoryStats: $('[data-category-stats]'),
    productsMore: $('[data-products-more]'),
    currencyForm: $('[data-currency-form]'),
    currencyError: $('[data-currency-error]'),
    kycForm: $('[data-kyc-form]'),
    kycError: $('[data-kyc-error]'),
    staffAvatar: $('[data-staff-avatar]'),
    staffName: $('[data-staff-name]'),
    sessionStatus: $('[data-session-status]')
  };

  // ---------------------------------------------------------------- utils

  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);

  const wholeFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  const centFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const money = (value) => {
    const amount = Number(value) || 0;
    return Number.isInteger(amount) ? wholeFormatter.format(amount) : centFormatter.format(amount);
  };

  const dateTime = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  };
  const shortDate = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  let toastTimer = null;
  function toast(message, isError = false) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.className = `admin-toast is-visible${isError ? ' admin-toast--error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3800);
  }

  function statusBadge(status) {
    const key = String(status || '').toLowerCase().replace(/[^a-z]/g, '');
    return `<span class="admin-status admin-status--${esc(key)}">${esc(status)}</span>`;
  }

  function table(headers, rows) {
    return `<table class="admin-table">
      <thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
  }

  function emptyState(title, copy, action = '') {
    return `<div class="admin-empty">
      <span class="admin-empty__mark">V</span>
      <strong>${esc(title)}</strong>
      <p>${esc(copy)}</p>
      ${action}
    </div>`;
  }

  function categoryName(slug) {
    return state.categories.find((category) => category.slug === slug)?.name || slug;
  }

  // ---------------------------------------------------------------- API

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) headers['x-velune-admin'] = state.token;
    let body = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    let response;
    try {
      response = await fetch(path, { method: options.method || 'GET', headers, body });
    } catch {
      throw new Error('The server could not be reached. Check that it is running.');
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (response.status === 401 && state.token) {
      signOut('Your session expired. Sign in again.');
      throw new Error(data.error || 'Session expired.');
    }
    if (!response.ok) {
      const error = new Error(data.error || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ---------------------------------------------------------------- auth

  function showLogin(message = '') {
    els.login.hidden = false;
    els.dashboard.hidden = true;
    if (els.loginError) els.loginError.textContent = message;
    closeSidebar();
    closeModal();
    setTimeout(() => $('#admin-username')?.focus(), 50);
  }

  function showDashboard() {
    els.login.hidden = true;
    els.dashboard.hidden = false;
    if (els.date) {
      els.date.textContent = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(new Date());
    }
  }

  function signOut(message = '') {
    state.token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    state.user = null;
    state.overview = null;
    state.orders = null;
    state.products = null;
    state.tickets = null;
    state.subscribers = null;
    state.customers = null;
    state.stores = null;
    state.integrations = null;
    state.integrationProviders = [];
    state.integrationJobs = [];
    state.integrationCatalog = null;
    state.settings = null;
    state.staff = null;
    state.verification = null;
    state.report = null;
    state.expenses = null;
    state.delivery = null;
    state.verifyDetailId = '';
    stopDeliveryPoll();
    releaseDocumentUrls();
    closeChatStream();
    showLogin(message);
  }

  els.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const usernameInput = $('#admin-username');
    const passwordInput = $('#admin-password');
    const username = usernameInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    if (!username || !password) {
      if (els.loginError) els.loginError.textContent = 'Enter your username and password.';
      (username ? passwordInput : usernameInput)?.focus();
      return;
    }
    if (els.loginError) els.loginError.textContent = '';
    if (els.loginSubmit) {
      els.loginSubmit.disabled = true;
      els.loginSubmit.textContent = 'Signing in…';
    }
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
      state.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      state.user = data.user || null;
      if (usernameInput) usernameInput.value = '';
      if (passwordInput) passwordInput.value = '';
      await startSession();
    } catch (error) {
      if (els.loginError) els.loginError.textContent = error.message;
      passwordInput?.focus();
    } finally {
      if (els.loginSubmit) {
        els.loginSubmit.disabled = false;
        els.loginSubmit.textContent = 'Enter dashboard';
      }
    }
  });

  $('[data-logout]')?.addEventListener('click', () => {
    signOut();
    toast('Signed out.');
  });

  // ---------------------------------------------------------------- routing

  const routeTitles = {
    overview: 'Overview',
    orders: 'Orders',
    products: 'Products',
    customers: 'Customers',
    stores: 'Stores',
    integrations: 'Integrations',
    verification: 'Verification',
    reports: 'Reports',
    chat: 'Live Chat',
    support: 'Support',
    delivery: 'Delivery',
    subscribers: 'Subscribers',
    team: 'Support team',
    settings: 'Settings'
  };

  // Route access is read straight off the nav markup: `data-admin-only` means
  // administrators only, `data-permission="a,b"` means an employee holding any
  // of those keys may open the view. Unknown routes stay administrator-only.
  const viewAccess = new Map();

  function buildAccessMap() {
    viewAccess.clear();
    $$('.admin-nav__item[data-route]').forEach((button) => {
      viewAccess.set(button.dataset.route, {
        adminOnly: button.dataset.adminOnly !== undefined,
        keys: String(button.dataset.permission || '')
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      });
    });
  }

  function isAdmin() {
    return state.user?.role === 'admin';
  }

  function hasPermission(key) {
    return isAdmin() || state.user?.permissions?.[key] === true;
  }

  function canView(route) {
    if (!state.user) return true;
    const rule = viewAccess.get(route);
    if (!rule) return isAdmin();
    if (rule.adminOnly) return isAdmin();
    if (!rule.keys.length) return true;
    return rule.keys.some(hasPermission);
  }

  function firstAllowedRoute() {
    return ['chat', 'support', 'products', 'customers', 'verification', 'reports', 'overview'].find((route) => canView(route)) || '';
  }

  function applyNavPermissions() {
    $$('.admin-nav__item[data-route]').forEach((button) => {
      button.hidden = !canView(button.dataset.route);
    });
  }

  function setStaffIdentity() {
    const user = state.user;
    if (!user) return;
    if (els.staffAvatar) els.staffAvatar.textContent = initialsOf(user.name || user.username || 'V').slice(0, 1);
    if (els.staffName) els.staffName.textContent = user.name || user.username || 'Staff member';
    if (els.sessionStatus) {
      els.sessionStatus.textContent =
        user.role === 'admin' ? 'Administrator session' : `Employee · ${(user.chatScope || 'all') === 'assigned' ? 'assigned chats only' : 'all chats'}`;
    }
  }

  async function loadSession() {
    const data = await request('/api/admin/session');
    state.user = data.user || null;
    buildAccessMap();
    applyNavPermissions();
    setStaffIdentity();
    return state.user;
  }

  function pickAllowedRoute() {
    const hashed = routeFromHash();
    if (hashed && canView(hashed)) return hashed;
    return firstAllowedRoute() || 'overview';
  }

  // One entry point for a signed-in session: resolve what this account may
  // open, land on the first allowed view, then fill the nav badges.
  async function startSession() {
    showDashboard();
    try {
      await loadSession();
    } catch (error) {
      if (state.token) toast(error.message, true);
      return;
    }
    const initial = pickAllowedRoute();
    if (window.location.hash !== `#${initial}`) window.history.replaceState({}, '', `#${initial}`);
    await activate(initial);
    if (initial !== 'overview') await loadBadgeContext();
  }

  // Employees without Overview access still need the chat and verification
  // counters in the sidebar, so ask the cheapest endpoint that reports them.
  async function loadBadgeContext() {
    try {
      state.overview = await request('/api/admin/overview');
      updateBadges();
      return;
    } catch {
      state.overview = null;
    }
    if (!canView('chat') && !canView('support')) return;
    try {
      const data = await request('/api/admin/chat');
      chat.conversations = data.conversations || chat.conversations;
      chat.unreadAdmin = deskUnreadTotal(data);
      updateBadges();
    } catch {
      /* the desk refreshes the badge as soon as it is opened */
    }
  }

  // `unreadAdmin` from the desk endpoint is the global counter (server.js:3831)
  // while the rows it returns are already scoped (server.js:3823), so a limited
  // agent must count the unread threads they can actually see.
  function deskUnreadTotal(data) {
    const scoped = state.user?.role === 'employee' && state.user?.chatScope === 'assigned';
    if (scoped) {
      return (data?.conversations || []).reduce((sum, entry) => sum + Number(entry.unread?.admin || 0), 0);
    }
    return Number(data?.unreadAdmin) || 0;
  }

  function routeFromHash() {
    const route = window.location.hash.replace(/^#/, '');
    return routeTitles[route] ? route : '';
  }

  function setActiveRoute(route) {
    $$('.admin-nav__item').forEach((button) => {
      const active = button.dataset.route === route;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $$('[data-view]').forEach((view) => {
      view.hidden = view.dataset.view !== route;
    });
    if (els.pageTitle) els.pageTitle.textContent = routeTitles[route];
    document.title = `${routeTitles[route]} — VELUNE Studio`;
  }

  async function activate(route) {
    if (!routeTitles[route]) route = 'overview';
    if (!canView(route)) {
      const fallback = firstAllowedRoute();
      toast(`Your employee account cannot open ${routeTitles[route]}.`, true);
      if (fallback && fallback !== route) {
        go(fallback);
        return;
      }
      route = fallback || 'chat';
    }
    state.route = route;
    setActiveRoute(route);
    if (route !== 'chat') closeChatStream();
    if (route !== 'delivery') stopDeliveryPoll();
    if (route !== 'verification') releaseDocumentUrls();
    try {
      if (route === 'overview') await loadOverview();
      if (route === 'orders') await loadOrders();
      if (route === 'products') await loadProducts();
      if (route === 'customers') await loadCustomers();
      if (route === 'stores') await loadStores();
      if (route === 'integrations') await loadIntegrations();
      if (route === 'verification') await loadVerification();
      if (route === 'reports') await loadReports();
      if (route === 'delivery') await loadDelivery();
      if (route === 'team') await loadStaff();
      if (route === 'chat') {
        // Desktop notification permission is only asked for once the desk is
        // opened deliberately — never while the page boots.
        askNotificationPermission();
        await loadChat();
      }
      if (route === 'support') await loadTickets();
      if (route === 'subscribers') await loadSubscribers();
      if (route === 'settings') await loadSettings();
    } catch (error) {
      if (state.token) toast(error.message, true);
    }
  }

  function go(route) {
    if (!routeTitles[route]) return;
    closeSidebar();
    if (window.location.hash === `#${route}`) {
      activate(route);
    } else {
      window.location.hash = route;
    }
  }

  window.addEventListener('hashchange', () => {
    if (!state.token) return;
    activate(routeFromHash() || firstAllowedRoute() || 'overview');
  });

  $$('[data-route]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      go(element.dataset.route);
    });
  });

  $$('[data-refresh]').forEach((button) => {
    button.addEventListener('click', () => {
      go(button.dataset.refresh);
    });
  });

  // ---------------------------------------------------------------- sidebar

  function openSidebar() {
    els.sidebar?.classList.add('is-open');
    if (els.sidebarScrim) els.sidebarScrim.hidden = false;
    document.body.classList.add('admin-locked');
  }
  function closeSidebar() {
    els.sidebar?.classList.remove('is-open');
    if (els.sidebarScrim) els.sidebarScrim.hidden = true;
    document.body.classList.remove('admin-locked');
  }
  $('[data-sidebar-toggle]')?.addEventListener('click', openSidebar);
  $('[data-sidebar-close]')?.addEventListener('click', closeSidebar);
  els.sidebarScrim?.addEventListener('click', closeSidebar);

  // ---------------------------------------------------------------- modal

  let lastFocused = null;

  function openModal(title, html) {
    if (!els.modal) return;
    lastFocused = document.activeElement;
    if (els.modalTitle) els.modalTitle.textContent = title;
    if (els.modalBody) els.modalBody.innerHTML = html;
    els.modal.hidden = false;
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-locked');
    requestAnimationFrame(() => {
      const first = els.modalBody?.querySelector('input:not([type="hidden"]), select, textarea, button');
      first?.focus();
    });
  }

  function closeModal() {
    if (!els.modal || els.modal.hidden) return;
    els.modal.hidden = true;
    els.modal.setAttribute('aria-hidden', 'true');
    if (els.modalBody) els.modalBody.innerHTML = '';
    document.body.classList.remove('admin-locked');
    lastFocused?.focus?.();
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (els.modal && !els.modal.hidden) closeModal();
    else closeSidebar();
  });

  // ---------------------------------------------------------------- badges

  function updateBadges() {
    const openTickets = state.tickets
      ? state.tickets.filter((ticket) => ticket.status === 'open').length
      : state.overview?.stats?.openTickets;
    const ticketBadge = $('[data-nav-tickets-count]');
    if (ticketBadge && Number.isFinite(Number(openTickets))) {
      ticketBadge.textContent = String(openTickets);
      ticketBadge.hidden = Number(openTickets) === 0;
    }
    if (els.lcNavCount) {
      const unread = chat.conversations.length
        ? chat.conversations.reduce((sum, entry) => sum + Number(entry.unread?.admin || 0), 0)
        : Number(chat.unreadAdmin) || 0;
      els.lcNavCount.textContent = String(unread);
      els.lcNavCount.hidden = unread === 0;
    }
    let pendingVerification;
    if (state.verification) {
      pendingVerification = (state.verification.queue || []).length;
    } else if (state.overview?.verification) {
      pendingVerification = Number(state.overview.verification.pending) || 0;
    }
    if (els.verifyNavCount && Number.isFinite(pendingVerification)) {
      els.verifyNavCount.textContent = String(pendingVerification);
      els.verifyNavCount.hidden = pendingVerification === 0;
    }
    if (els.deliveryNavCount && state.delivery) {
      const undelivered = (state.delivery.outbox || []).filter((entry) => entry.status !== 'sent').length;
      els.deliveryNavCount.textContent = String(undelivered);
      els.deliveryNavCount.hidden = undelivered === 0;
    }
    const activeOrders = state.orders
      ? state.orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Cancelled').length
      : null;
    const orderBadge = $('[data-nav-orders-count]');
    if (orderBadge && activeOrders !== null) {
      orderBadge.textContent = String(activeOrders);
      orderBadge.hidden = activeOrders === 0;
    }
  }

  // ---------------------------------------------------------------- overview

  async function loadOverview() {
    const data = await request('/api/admin/overview');
    state.overview = data;
    const stats = data.stats;

    const statGrid = $('[data-overview-stats]');
    if (statGrid) {
      statGrid.innerHTML = `
        <article class="stat-card">
          <span class="stat-card__label">Revenue · 30 days</span>
          <strong class="stat-card__value">${money(stats.revenue30)}</strong>
          <span class="stat-card__note">Across ${stats.orders30} ${stats.orders30 === 1 ? 'order' : 'orders'} · COD totals</span>
        </article>
        <article class="stat-card">
          <span class="stat-card__label">Orders · 30 days</span>
          <strong class="stat-card__value">${stats.orders30}</strong>
          <span class="stat-card__note">${stats.allOrders} ${stats.allOrders === 1 ? 'order' : 'orders'} all time</span>
        </article>
        <article class="stat-card">
          <span class="stat-card__label">Average order value</span>
          <strong class="stat-card__value">${money(stats.aov30)}</strong>
          <span class="stat-card__note">Last 30 days, before tax</span>
        </article>
        <article class="stat-card stat-card--attention">
          <span class="stat-card__label">Needs attention</span>
          <strong class="stat-card__value">${stats.lowStock + stats.openTickets}</strong>
          <span class="stat-card__note">${stats.lowStock} low stock · ${stats.openTickets} open ${stats.openTickets === 1 ? 'ticket' : 'tickets'}</span>
        </article>`;
    }

    const recent = $('[data-recent-orders]');
    if (recent) {
      if (!data.recentOrders.length) {
        recent.innerHTML = emptyState('No orders yet', 'New orders from the storefront appear here.');
      } else {
        recent.innerHTML = table(
          ['Order', 'Customer', 'Total', 'Status'],
          data.recentOrders.map(
            (order) => `<tr>
              <td>
                <button class="admin-order-link" type="button" data-order-view="${esc(order.number)}">${esc(order.number)}</button>
                <span class="admin-sub">${esc(shortDate(order.createdAt))}</span>
              </td>
              <td>${esc(`${order.customer.firstName} ${order.customer.lastName}`)}<span class="admin-sub">${esc(order.customer.email)}</span></td>
              <td class="admin-num">${money(order.total)}</td>
              <td>${statusBadge(order.status)}</td>
            </tr>`
          )
        );
      }
    }

    const attention = $('[data-attention]');
    if (attention) {
      const items = [];
      if (stats.lowStock > 0) {
        items.push(`<button class="attention-item" type="button" data-route="products">
          <span class="attention-item__icon attention-item__icon--stock">${stats.lowStock}</span>
          <span class="attention-item__copy"><strong>Low stock</strong><span>${stats.lowStock} ${stats.lowStock === 1 ? 'product is' : 'products are'} at or below 8 units.</span></span>
          <span class="attention-item__arrow">→</span>
        </button>`);
      }
      if (stats.openTickets > 0) {
        items.push(`<button class="attention-item" type="button" data-route="support">
          <span class="attention-item__icon attention-item__icon--ticket">${stats.openTickets}</span>
          <span class="attention-item__copy"><strong>Open tickets</strong><span>${stats.openTickets} ${stats.openTickets === 1 ? 'conversation needs' : 'conversations need'} a human reply.</span></span>
          <span class="attention-item__arrow">→</span>
        </button>`);
      }
      items.push(`<div class="attention-item attention-item--static">
        <span class="attention-item__icon">${stats.subscribers}</span>
        <span class="attention-item__copy"><strong>Newsletter subscribers</strong><span>No campaign tool is connected in this build.</span></span>
      </div>`);
      if (stats.lowStock === 0 && stats.openTickets === 0) {
        items.unshift(`<div class="attention-item attention-item--clear">
          <span class="attention-item__icon attention-item__icon--clear">✓</span>
          <span class="attention-item__copy"><strong>Nothing urgent</strong><span>Stock and support are both in good shape.</span></span>
        </div>`);
      }
      attention.innerHTML = `<div class="attention-list">${items.join('')}</div>`;
      $$('[data-route]', attention).forEach((element) => {
        element.addEventListener('click', (event) => {
          event.preventDefault();
          go(element.dataset.route);
        });
      });
    }

    const top = $('[data-top-products]');
    if (top) {
      if (!data.topProducts.length) {
        top.innerHTML = `<p class="admin-muted admin-pad">No units sold yet. Top products appear after the first order.</p>`;
      } else {
        top.innerHTML = `<div class="rank-list">${data.topProducts
          .map(
            (product, index) => `<div class="rank-item">
              <span class="rank-index">${String(index + 1).padStart(2, '0')}</span>
              <div class="rank-copy"><strong>${esc(product.name)}</strong><span>${esc(product.slug)}</span></div>
              <span class="rank-units">${product.units} ${product.units === 1 ? 'unit' : 'units'}</span>
            </div>`
          )
          .join('')}</div>`;
      }
    }

    updateBadges();
  }

  // ---------------------------------------------------------------- orders

  async function loadOrders() {
    const data = await request('/api/admin/orders');
    state.orders = data.orders;
    renderOrders();
    updateBadges();
  }

  function renderOrders() {
    if (!els.ordersTable || !state.orders) return;
    const term = (els.orderSearch?.value || '').trim().toLowerCase();
    const status = els.orderStatus?.value || 'all';
    const payment = els.orderPayment?.value || 'all';
    const filtered = state.orders.filter((order) => {
      if (status !== 'all' && order.status !== status) return false;
      if (payment !== 'all' && (order.paymentStatus || 'Awaiting Payment') !== payment) return false;
      if (!term) return true;
      const haystack = `${order.number} ${order.customer.firstName} ${order.customer.lastName} ${order.customer.email}`.toLowerCase();
      return haystack.includes(term);
    });

    const awaitingProof = state.orders.filter((order) => order.paymentStatus === 'Proof submitted').length;
    if (els.orderPayment) {
      const option = els.orderPayment.querySelector('option[value="Proof submitted"]');
      if (option) option.textContent = awaitingProof ? `Slip submitted (${awaitingProof})` : 'Slip submitted';
    }

    if (els.ordersCount) {
      els.ordersCount.textContent = `${filtered.length} of ${state.orders.length} ${state.orders.length === 1 ? 'order' : 'orders'}`;
    }

    if (!state.orders.length) {
      els.ordersTable.innerHTML = emptyState(
        'No orders yet',
        'Orders will appear here as soon as a checkout is completed.',
        '<a class="admin-btn admin-btn--outline" href="/shop" target="_blank" rel="noopener">Open storefront</a>'
      );
      return;
    }
    if (!filtered.length) {
      els.ordersTable.innerHTML = emptyState('No matching orders', 'Try a different search term or status filter.');
      return;
    }

    els.ordersTable.innerHTML = table(
      ['Order', 'Customer', 'Date', 'Items', 'Total', 'Status', 'Payment', ''],
      filtered.map((order) => {
        const units = order.items.reduce((sum, item) => sum + Number(item.qty), 0);
        const proofs = Array.isArray(order.paymentProof) ? order.paymentProof : [];
        const latest = proofs[proofs.length - 1];
        return `<tr>
          <td><button class="admin-order-link" type="button" data-order-view="${esc(order.number)}">${esc(order.number)}</button></td>
          <td>${esc(`${order.customer.firstName} ${order.customer.lastName}`)}<span class="admin-sub">${esc(order.customer.email)}</span></td>
          <td class="admin-nowrap">${esc(shortDate(order.createdAt))}</td>
          <td class="admin-num">${units}</td>
          <td class="admin-num">${money(order.total)}</td>
          <td>${statusBadge(order.status)}</td>
          <td>
            <span class="om-pay-status${order.paymentStatus === 'Paid' ? ' om-pay-status--paid' : order.paymentStatus === 'Proof submitted' ? ' om-pay-status--proof' : order.paymentStatus === 'Awaiting Payment' ? ' om-pay-status--pending' : ''}">${esc(order.paymentStatus || 'Awaiting Payment')}</span>
            <span class="admin-sub">${esc(order.paymentMethod || '')}${latest ? ` · ${esc(latest.status || 'pending')} slip` : ''}</span>
          </td>
          <td class="admin-cell-action"><button class="admin-btn admin-btn--tiny" type="button" data-order-view="${esc(order.number)}">Manage</button></td>
        </tr>`;
      })
    );
  }

  els.orderSearch?.addEventListener('input', renderOrders);
  els.orderStatus?.addEventListener('change', renderOrders);
  els.orderPayment?.addEventListener('change', renderOrders);

  // Payment slips a customer uploaded for this order, newest first.
  function proofStripMarkup(order) {
    const proofs = Array.isArray(order.paymentProof) ? order.paymentProof : [];
    if (!proofs.length) return '<p class="om-proof__none">No payment slip uploaded yet.</p>';
    const latest = proofs[proofs.length - 1];
    return `<div class="om-proofs">
      <h4>Payment slips</h4>
      <div class="om-proofs__row">
        ${proofs
          .slice(-3)
          .reverse()
          .map(
            (proof) => `<figure class="om-proof${proof.status ? ` is-${proof.status}` : ''}">
              <a href="${esc(proof.path)}" target="_blank" rel="noopener"><img src="${esc(proof.path)}" alt="Payment slip" loading="lazy"></a>
              <figcaption>${esc(dateTime(proof.uploadedAt))} · ${esc(proof.status || 'pending')}</figcaption>
            </figure>`
          )
          .join('')}
      </div>
      ${latest.status === 'accepted' || order.paymentStatus === 'Paid'
        ? ''
        : `<div class="om-actions om-actions--proof">
             <button class="admin-btn admin-btn--tiny admin-btn--primary" type="button" data-proof-decision="accepted">Approve · mark paid</button>
             <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-proof-decision="rejected">Reject slip</button>
           </div>`}
    </div>`;
  }

  async function findOrder(number) {
    if (state.orders) {
      const found = state.orders.find((order) => order.number === number);
      if (found) return found;
    }
    const data = await request('/api/admin/orders');
    state.orders = data.orders;
    renderOrders();
    return state.orders.find((order) => order.number === number);
  }

  async function openOrderModal(number) {
    let order;
    try {
      order = await findOrder(number);
    } catch (error) {
      toast(error.message, true);
      return;
    }
    if (!order) {
      toast('Order not found. Refresh and try again.', true);
      return;
    }

    const items = order.items
      .map(
        (item) => `<div class="om-item">
          <img src="${esc(item.image)}" alt="" width="36" height="45" loading="lazy">
          <div class="om-item__copy">
            <strong>${esc(item.name)}</strong>
            <span>${item.variant ? `${esc(item.variant)} · ` : ''}Qty ${Number(item.qty)} · ${money(item.price)}</span>
          </div>
          <span class="om-item__total">${money(Number(item.price) * Number(item.qty))}</span>
        </div>`
      )
      .join('');

    const history = (order.statusHistory || [])
      .map((entry) => `<li><span>${esc(entry.status)}</span><span>${esc(dateTime(entry.at))}</span></li>`)
      .join('');

    const form = `<form data-order-update data-order-number="${esc(order.number)}">
      <div class="om-head">
        <div>
          <span class="om-number">${esc(order.number)}</span>
          <span class="admin-sub">Placed ${esc(dateTime(order.createdAt))}</span>
        </div>
        ${statusBadge(order.status)}
      </div>
      <div class="om-grid">
        <div class="om-section">
          <h3>Items</h3>
          ${items}
          <div class="om-totals">
            <div><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
            ${Number(order.discount) > 0 ? `<div><span>Discount${order.promoCode ? ` (${esc(order.promoCode)})` : ''}</span><span>−${money(order.discount)}</span></div>` : ''}
            <div><span>Shipping</span><span>${Number(order.shippingCost) > 0 ? money(order.shippingCost) : 'Complimentary'}</span></div>
            <div><span>Tax</span><span>${money(order.tax)}</span></div>
            <div class="om-totals__grand"><span>Total</span><span>${money(order.total)}</span></div>
          </div>
        </div>
        <div>
          <div class="om-section">
            <h3>Customer</h3>
            <p>${esc(`${order.customer.firstName} ${order.customer.lastName}`)}<br>
            <a class="admin-link" href="mailto:${encodeURIComponent(order.customer.email)}">${esc(order.customer.email)}</a>
            ${order.customer.phone ? `<br>${esc(order.customer.phone)}` : ''}</p>
          </div>
          <div class="om-section">
            <h3>Ship to</h3>
            <p>${esc(order.shipping.address1)}${order.shipping.address2 ? `<br>${esc(order.shipping.address2)}` : ''}<br>
            ${esc(order.shipping.city)}, ${esc(order.shipping.state)} ${esc(order.shipping.zip)}<br>United States</p>
          </div>
          <div class="om-section">
            <h3>Delivery &amp; payment</h3>
            <p>${esc(order.shippingMethod)} · ${order.shippingMethod === 'express' ? '1–2 business days' : '3–5 business days'}<br>
            <span class="om-pay-status${(order.paymentStatus||'')==='Paid'?' om-pay-status--paid':(order.paymentStatus||'')==='Awaiting Payment'?' om-pay-status--pending':(order.paymentStatus||'')==='Proof submitted'?' om-pay-status--proof':''}">${esc(order.paymentStatus || 'Awaiting Payment')}</span></p>
            ${order.paymentMethod ? `<p style="font-size:11.5px;color:var(--muted);margin-top:4px;">${esc(order.paymentMethod)}${order.paymentReference ? ` · ref ${esc(order.paymentReference)}` : ''}</p>` : ''}
            ${proofStripMarkup(order)}
            ${order.notes ? `<p class="om-note">“${esc(order.notes)}”</p>` : ''}
          </div>
          <div class="om-section">
            <h3>Update</h3>
            <label class="admin-field">
              <span>Order status</span>
              <select name="status" class="admin-select">
                ${STATUSES.map((status) => `<option value="${status}"${status === order.status ? ' selected' : ''}>${status}</option>`).join('')}
              </select>
            </label>
            <label class="admin-field">
              <span>Payment status</span>
              <select name="paymentStatus" class="admin-select">
                ${PAYMENT_STATUSES.map((ps) => `<option value="${ps}"${ps === (order.paymentStatus || 'Awaiting Payment') ? ' selected' : ''}>${ps}</option>`).join('')}
              </select>
            </label>
            <label class="admin-field">
              <span>Payment reference</span>
              <input class="admin-input" name="paymentReference" maxlength="80" value="${esc(order.paymentReference || '')}" placeholder="UPI / Binance / tx reference">
            </label>
            <label class="admin-field">
              <span>Tracking number</span>
              <input class="admin-input" name="trackingNumber" maxlength="80" value="${esc(order.trackingNumber || '')}" placeholder="Not yet assigned">
            </label>
            ${history ? `<div class="om-history"><h3>History</h3><ul>${history}</ul></div>` : ''}
          </div>          </div>
        </div>
      </div>
      <p class="admin-form-error" role="alert" data-order-error></p>
      <p class="om-warning">Changing status to <strong>Cancelled</strong> returns this order's items to stock and cannot be undone from this screen.</p>
      <div class="om-actions">
        <button class="admin-btn" type="button" data-modal-close>Close</button>
        <button class="admin-btn admin-btn--primary" type="submit" data-order-save>Save changes</button>
      </div>
    </form>`;

    openModal(`Order ${order.number}`, form);

    $('[data-order-update]', els.modalBody)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formNode = event.currentTarget;
      const errorNode = $('[data-order-error]', formNode);
      const saveButton = $('[data-order-save]', formNode);
      const formData = new FormData(formNode);
      const status = String(formData.get('status') || '');
      const paymentStatus = String(formData.get('paymentStatus') || '');
      const trackingNumber = String(formData.get('trackingNumber') || '').trim();
      const paymentReference = String(formData.get('paymentReference') || '').trim();
      if (errorNode) errorNode.textContent = '';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
      }
      try {
        await request(`/api/admin/orders/${encodeURIComponent(order.number)}`, {
          method: 'PATCH',
          json: { status, paymentStatus, trackingNumber, paymentReference }
        });
        if (saveButton) saveButton.textContent = 'Saved';
        closeModal();
        toast(`Order ${order.number} updated.`);
        await loadOrders();
        if (state.route === 'overview') await loadOverview();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = 'Save changes';
        }
      }
    });
  }

  // ---------------------------------------------------------------- products

  async function loadProducts() {
    const data = await request('/api/admin/products');
    state.products = data.products;
    state.categories = data.categories || [];
    state.productRows = PRODUCT_PAGE_SIZE;
    fillCategoryOptions();
    renderProducts();
  }

  function fillCategoryOptions() {
    if (!els.productCategory) return;
    els.productCategory.innerHTML =
      '<option value="all">All categories</option>' +
      state.categories.map((category) => `<option value="${esc(category.slug)}">${esc(category.name)}</option>`).join('');
  }

  // The storefront default currency is informational only in the desk: costs,
  // prices and reports are stored in USD, the base currency of the catalogue.
  function secondaryPriceLine(product) {
    const symbol = String(product?.currencies?.symbols?.INR || '');
    const inr = Number(product?.priceInr);
    if (!symbol || !Number.isFinite(inr)) return '';
    return `<span class="admin-sub">${esc(symbol)}${esc(inr.toLocaleString('en-IN'))} · ${esc(product?.currencies?.display || 'USD')}</span>`;
  }

  function productPriceCell(product) {
    return `<td class="admin-num">${money(product.price)}${product.compareAt ? `<s>${money(product.compareAt)}</s>` : ''}${secondaryPriceLine(product)}</td>`;
  }

  function renderProducts() {
    if (!els.productsTable || !state.products) return;
    const term = (els.productSearch?.value || '').trim().toLowerCase();
    const category = els.productCategory?.value || 'all';
    const filtered = state.products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (!term) return true;
      return `${product.name} ${product.id} ${product.slug} ${product.categoryName}`.toLowerCase().includes(term);
    });

    if (els.productsCount) {
      const missing = filtered.filter((product) => product.photoRequired).length;
      els.productsCount.textContent = `${filtered.length} of ${state.products.length} ${state.products.length === 1 ? 'product' : 'products'}${
        missing ? ` · ${missing} need ${missing === 1 ? 'a photo' : 'photos'}` : ''
      }`;
    }

    if (!filtered.length) {
      els.productsTable.innerHTML = emptyState('No products match', 'Adjust the search or category filter.');
      if (els.productsMore) {
        els.productsMore.hidden = true;
        els.productsMore.innerHTML = '';
      }
      renderCategoryStats();
      return;
    }

    // 213 SKUs render into the DOM at once freezes the panel, so the table is
    // capped and extended with a load-more control.
    const shown = filtered.slice(0, state.productRows);
    els.productsTable.innerHTML = table(
      ['Product', 'Category', 'Price', 'Cost', 'Profit', 'Stock', 'Status', ''],
      shown.map((product) => {
        const soldOut = product.stock < 1;
        const low = product.stock > 0 && product.stock <= 8;
        return `<tr>
          <td>
            <div class="product-cell">
              ${
                isPhotoUrl(product.cardImage)
                  ? `<img src="${esc(product.cardImage)}" alt="" width="38" height="48" loading="lazy" decoding="async">`
                  : '<span class="admin-photo-missing" title="Upload a real product photograph">Photo required</span>'
              }
              <div>
                <strong>${esc(product.name)}</strong>
                <span class="admin-sub">${esc(product.id)}</span>
              </div>
            </div>
          </td>
          <td>${esc(categoryName(product.category))}</td>
          ${productPriceCell(product)}
          <td class="admin-num">${product.baseCost === null || product.baseCost === undefined ? '—' : money(product.baseCost)}</td>
          <td class="admin-num${product.tracked ? '' : ' admin-muted'}">${
            product.profit === null || product.profit === undefined
              ? '—'
              : `${money(product.profit)}${product.marginPercent !== null && product.marginPercent !== undefined ? `<span class="admin-sub">${Number(product.marginPercent).toFixed(1)}%</span>` : ''}`
          }</td>
          <td class="admin-num${soldOut ? ' admin-stock--out' : low ? ' admin-stock--low' : ''}">${product.stock}</td>
          <td>${soldOut ? '<span class="admin-status admin-status--cancelled">Sold out</span>' : low ? '<span class="admin-status admin-status--low">Low</span>' : '<span class="admin-status admin-status--active">Active</span>'}</td>
          <td class="admin-cell-action"><button class="admin-btn admin-btn--tiny" type="button" data-product-edit="${esc(product.slug)}">Edit</button></td>
        </tr>`;
      })
    );

    const remaining = filtered.length - shown.length;
    if (els.productsMore) {
      els.productsMore.hidden = remaining <= 0;
      els.productsMore.innerHTML = remaining
        ? `<span class="admin-muted">Showing ${shown.length} of ${filtered.length}</span>
           <button class="admin-btn admin-btn--outline" type="button" data-products-loadmore>Show ${Math.min(PRODUCT_PAGE_SIZE, remaining)} more</button>`
        : '';
    }
    renderCategoryStats();
  }

  function renderCategoryStats() {
    if (!els.categoryStats || !state.products) return;
    if (!state.categories.length) {
      els.categoryStats.innerHTML = '<p class="admin-muted admin-pad">No categories yet.</p>';
      return;
    }
    const rows = state.categories.map((category) => {
      const items = state.products.filter((product) => product.category === category.slug);
      const prices = items.map((product) => Number(product.price)).filter((value) => Number.isFinite(value));
      const stock = items.reduce((sum, product) => sum + (Number(product.stock) || 0), 0);
      const tracked = items.filter((product) => product.tracked && Number.isFinite(product.profit));
      const avgProfit = tracked.length
        ? tracked.reduce((sum, product) => sum + Number(product.profit), 0) / tracked.length
        : null;
      const lowStock = items.filter((product) => product.stock <= 8).length;
      const min = prices.length ? Math.min(...prices) : null;
      const max = prices.length ? Math.max(...prices) : null;
      return `<tr>
        <td><strong>${esc(category.name)}</strong><span class="admin-sub">${esc(category.slug)}</span></td>
        <td class="admin-num">${items.length}</td>
        <td class="admin-num">${min === null ? '—' : min === max ? money(min) : `${money(min)}–${money(max)}`}</td>
        <td class="admin-num">${avgProfit === null ? '—' : money(avgProfit)}<span class="admin-sub">${avgProfit === null ? 'no costs tracked' : 'avg profit'}</span></td>
        <td class="admin-num${stock === 0 ? ' admin-stock--out' : ''}">${stock}</td>
        <td>${lowStock ? `<span class="admin-status admin-status--low">${lowStock} low</span>` : '<span class="admin-status admin-status--active">Healthy</span>'}</td>
      </tr>`;
    });
    els.categoryStats.innerHTML = table(
      ['Category', 'SKUs', 'Price range', 'Margin', 'Stock held', 'Stock alerts'],
      rows
    );
  }

  els.productSearch?.addEventListener('input', () => {
    state.productRows = PRODUCT_PAGE_SIZE;
    renderProducts();
  });
  els.productCategory?.addEventListener('change', () => {
    state.productRows = PRODUCT_PAGE_SIZE;
    renderProducts();
  });
  els.productsMore?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-products-loadmore]')) return;
    state.productRows += PRODUCT_PAGE_SIZE;
    renderProducts();
  });

  function productForm(product = null) {
    const isEdit = Boolean(product);
    const hasPhoto = isPhotoUrl(product?.image);
    // A legacy catalogue row has no tracked cost, so it must open in manual
    // mode: the server rejects formula pricing without a base cost.
    const tracked = product ? product.baseCost !== null && product.baseCost !== undefined : false;
    const priceMode = product ? (product.priceMode || (tracked ? 'formula' : 'manual')) : 'formula';
    const baseCostValue = product ? (product.baseCost ?? '') : 46;
    const profitValue = product ? (product.profit ?? 6) : 6;
    const options = state.categories
      .map(
        (category) =>
          `<option value="${esc(category.slug)}"${(product?.category || state.categories[0]?.slug) === category.slug ? ' selected' : ''}>${esc(category.name)}</option>`
      )
      .join('');
    return `<form data-product-form data-product-slug="${esc(product?.slug || '')}" data-product-name="${esc(product?.name || '')}">
      <div class="admin-form-grid">
        <label class="admin-field admin-span-2">
          <span>Product name</span>
          <input class="admin-input" name="name" required minlength="2" maxlength="90" value="${esc(product?.name || '')}">
        </label>
        <label class="admin-field">
          <span>Category</span>
          <select class="admin-select" name="category" required>${options}</select>
        </label>
        <label class="admin-field">
          <span>Badge <em>optional</em></span>
          <input class="admin-input" name="badge" maxlength="24" value="${esc(product?.badge || '')}" placeholder="Bestseller">
        </label>
        <div class="pc-panel">
          <input type="hidden" name="priceMode" value="${esc(priceMode)}">
          <div class="admin-field">
            <span>Pricing</span>
            <div class="admin-segmented pc-mode" role="group" aria-label="Price mode">
              <button type="button" data-price-mode="formula"${priceMode === 'formula' ? ' class="is-active"' : ''}>Cost + profit</button>
              <button type="button" data-price-mode="manual"${priceMode === 'manual' ? ' class="is-active"' : ''}>Manual price</button>
            </div>
            <small>Selling price = base cost + profit. Formula mode keeps the price derived; manual mode pins it.</small>
          </div>
          <label class="admin-field">
            <span>Base cost (USD)</span>
            <input class="admin-input" name="baseCost" type="number" min="0" max="10000000" step="0.01" value="${esc(baseCostValue)}" placeholder="46.00">
            <small>Leave blank to stop tracking cost for this product.</small>
          </label>
          <label class="admin-field">
            <span>Profit (USD)</span>
            <input class="admin-input" name="profit" type="number" min="0" max="10000000" step="0.01" value="${esc(profitValue)}" placeholder="6.00">
          </label>
          <label class="admin-field">
            <span>Selling price (USD)</span>
            <input class="admin-input" name="price" type="number" min="1" max="10000000" step="0.01" required
              value="${esc(product?.price ?? '')}"${priceMode === 'formula' ? ' readonly' : ''}>
          </label>
          <label class="admin-field">
            <span>Compare-at price <em>optional</em></span>
            <input class="admin-input" name="compareAt" type="number" min="0" max="10000000" step="0.01" value="${esc(product?.compareAt ?? '')}" placeholder="Optional — ignored when not above the price">
          </label>
          <p class="pc-computed" data-price-computed></p>
        </div>
        <label class="admin-field">
          <span>Stock</span>
          <input class="admin-input" name="stock" type="number" min="0" max="100000" step="1" required value="${esc(product?.stock ?? 10)}">
        </label>
        <label class="admin-field">
          <span>SKU / handle</span>
          <input class="admin-input" value="${esc(product?.id || 'Generated from name')}" disabled>
        </label>
        <div class="admin-field admin-span-2">
          <span>Product image</span>
          <div class="admin-upload-row">
            <input class="admin-input" name="image" required value="${esc(product?.image || '')}" placeholder="/images/products/example-800.jpg">
            <label class="admin-btn admin-btn--outline admin-upload-btn">
              Upload image
              <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-image-file hidden>
            </label>
          </div>
          <small>Upload a JPEG, PNG or WebP up to 5 MB. The storefront shows photographs only; legacy <code>.svg</code> packshots are hidden. Use a 4:5 image, ideally 800 × 1000.</small>
          <span class="admin-upload-status" role="status" data-upload-status></span>
        </div>
        <div class="admin-span-2 product-preview" data-preview-box>
          <div class="product-preview__toolbar" data-preview-toolbar hidden>
            <span class="product-preview__theme-label">Background</span>
            <span class="product-preview__theme" role="group" aria-label="Preview background">
              <button type="button" data-preview-theme="light">Light</button>
              <button type="button" data-preview-theme="dark">Dark</button>
            </span>
          </div>
          <div class="product-preview__stage">
            <img data-product-preview src="${hasPhoto ? esc(product.image) : ''}" alt="Product preview" ${hasPhoto ? '' : 'hidden'}>
            <span data-preview-empty ${hasPhoto ? 'hidden' : ''}>${
            product?.image ? 'Legacy vector art is hidden. Upload a real product photograph.' : 'Photo required — upload a real product photograph.'
          }</span>
          </div>
        </div>
        <label class="admin-field admin-span-2">
          <span>Short description</span>
          <textarea class="admin-input admin-textarea" name="short" maxlength="220" rows="2" placeholder="One clear sentence for cards and search.">${esc(product?.short || '')}</textarea>
        </label>
        <label class="admin-field admin-span-2">
          <span>Full description</span>
          <textarea class="admin-input admin-textarea" name="description" minlength="10" maxlength="2000" rows="5" required>${esc(product?.description || '')}</textarea>
        </label>
        <label class="admin-field">
          <span>Detail bullets <em>one per line</em></span>
          <textarea class="admin-input admin-textarea" name="details" rows="4" placeholder="Solid walnut base&#10;Hand-finished brass">${esc((product?.details || []).join('\n'))}</textarea>
        </label>
        <label class="admin-field">
          <span>Specifications <em>Key: Value per line</em></span>
          <textarea class="admin-input admin-textarea" name="specs" rows="4" placeholder="Materials: Walnut, brass&#10;Dimensions: 18 × 9 in">${esc((product?.specs || []).map((spec) => `${spec.k}: ${spec.v}`).join('\n'))}</textarea>
        </label>
        <label class="admin-field admin-span-2">
          <span>Variants <em>Group: Option, Option</em></span>
          <textarea class="admin-input admin-textarea" name="variants" rows="3" placeholder="Finish: Natural oak, Walnut&#10;Size: Small, Large">${esc((product?.variants || []).map((variant) => `${variant.name}: ${variant.options.join(', ')}`).join('\n'))}</textarea>
          <small>Leave blank for no variants. The first option is preselected on the product page.</small>
        </label>
        <label class="admin-check"><input type="checkbox" name="featured" ${product?.featured ? 'checked' : ''}> Featured on the storefront</label>
        <label class="admin-check"><input type="checkbox" name="isNew" ${product?.isNew || !isEdit ? 'checked' : ''}> Mark as new</label>
      </div>
      <p class="admin-form-error" role="alert" data-product-error></p>
      <p class="admin-form-hint">Product changes publish immediately. Uploaded images are written to the configured uploads directory and survive restarts when it is on a persistent volume.</p>
      <div class="om-actions">
        ${isEdit ? '<button class="admin-btn admin-btn--danger" type="button" data-product-delete>Delete</button>' : ''}
        <span class="admin-actions-spacer"></span>
        <button class="admin-btn" type="button" data-modal-close>Cancel</button>
        <button class="admin-btn admin-btn--primary" type="submit" data-product-save>${isEdit ? 'Save changes' : 'Create product'}</button>
      </div>
    </form>`;
  }

  function openProductModal(product = null) {
    openModal(product ? `Edit — ${product.name}` : 'Add product', productForm(product));
    const form = $('[data-product-form]', els.modalBody);
    if (!form) return;
    const imageInput = $('input[name="image"]', form);
    const preview = $('[data-product-preview]', form);
    const previewEmpty = $('[data-preview-empty]', form);
    const previewBox = $('[data-preview-box]', form);
    const previewToolbar = $('[data-preview-toolbar]', form);

    // ── preview background theme ──────────────────────────────
    const applyPreviewTheme = (theme) => {
      if (!previewBox) return;
      previewBox.classList.toggle('is-dark', theme === 'dark');
      for (const btn of $$('[data-preview-theme]', form)) {
        const active = btn.dataset.previewTheme === theme;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      }
    };
    applyPreviewTheme(readProductPreviewTheme());
    for (const btn of $$('[data-preview-theme]', form)) {
      btn.addEventListener('click', () => {
        const next = btn.dataset.previewTheme === 'dark' ? 'dark' : 'light';
        applyPreviewTheme(next);
        saveProductPreviewTheme(next);
      });
    }
    // ── end preview background theme ──────────────────────────

    const updatePreview = () => {
      const value = imageInput?.value.trim() || '';
      if (!preview) return;
      if (!value || !isPhotoUrl(value)) {
        preview.hidden = true;
        preview.removeAttribute('src');
        if (previewEmpty) {
          previewEmpty.hidden = false;
          previewEmpty.textContent = value
            ? 'Legacy vector art is hidden. Upload a real product photograph.'
            : 'Photo required — upload a real product photograph.';
        }
        if (previewToolbar) previewToolbar.hidden = true;
        return;
      }
      preview.src = value;
      preview.hidden = false;
      if (previewEmpty) previewEmpty.hidden = true;
      if (previewToolbar) previewToolbar.hidden = false;
    };
    imageInput?.addEventListener('input', updatePreview);

    // ── pricing controls ──────────────────────────────────────
    const modeInput = $('input[name="priceMode"]', form);
    const costInput = $('input[name="baseCost"]', form);
    const profitInput = $('input[name="profit"]', form);
    const priceInput = $('input[name="price"]', form);
    const computedLine = $('[data-price-computed]', form);
    const numberOrNull = (input) => {
      if (!input || String(input.value).trim() === '') return null;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : null;
    };
    const effectivePrice = () => {
      if (modeInput?.value === 'formula') {
        const cost = numberOrNull(costInput);
        const profit = numberOrNull(profitInput) ?? 0;
        return cost === null ? NaN : Math.round((cost + profit) * 100) / 100;
      }
      const manual = numberOrNull(priceInput);
      return manual === null ? NaN : manual;
    };
    const syncPricing = () => {
      const formula = modeInput?.value === 'formula';
      $$('[data-price-mode]', form).forEach((button) => button.classList.toggle('is-active', button.dataset.priceMode === modeInput?.value));
      if (priceInput) {
        if (formula) {
          const computed = effectivePrice();
          if (Number.isFinite(computed)) priceInput.value = computed.toFixed(2);
          priceInput.readOnly = true;
        } else {
          priceInput.readOnly = false;
        }
      }
      if (!computedLine) return;
      const cost = numberOrNull(costInput);
      const profit = numberOrNull(profitInput);
      const computed = effectivePrice();
      if (formula && cost === null) {
        computedLine.innerHTML = '<span class="admin-muted">Formula pricing needs a base cost — add one or switch to a manual price.</span>';
      } else if (!Number.isFinite(computed)) {
        computedLine.innerHTML = '<span class="admin-muted">Enter a selling price.</span>';
      } else {
        const margin = cost && profit !== null ? Math.round((profit / cost) * 10000) / 100 : null;
        computedLine.innerHTML = `${esc(money(computed))}${
          formula && cost !== null && profit !== null
            ? ` = ${esc(money(cost))} cost + ${esc(money(profit))} profit`
            : ' set manually'
        }${margin !== null && margin > 0 ? ` · <span class="admin-muted">mark-up on cost ${esc(margin.toFixed(1))}%</span>` : ''}`;
      }
    };
    $$('[data-price-mode]', form).forEach((button) => {
      button.addEventListener('click', () => {
        if (modeInput) modeInput.value = button.dataset.priceMode;
        syncPricing();
      });
    });
    [costInput, profitInput, priceInput].forEach((input) => input?.addEventListener('input', syncPricing));
    syncPricing();
    // ── end pricing controls ──────────────────────────────────

    preview?.addEventListener('error', () => {
      preview.hidden = true;
      if (previewEmpty) {
        previewEmpty.hidden = false;
        previewEmpty.textContent = 'Image not found at this path';
      }
      if (previewToolbar) previewToolbar.hidden = true;
    });
    preview?.addEventListener('load', () => {
      preview.hidden = false;
      if (previewEmpty) previewEmpty.hidden = true;
      if (previewToolbar) previewToolbar.hidden = false;
    });
    updatePreview();

    const fileInput = $('[data-image-file]', form);
    const uploadLabel = $('.admin-upload-btn', form);
    const uploadStatus = $('[data-upload-status]', form);
    const setUploadStatus = (message, type = '') => {
      if (!uploadStatus) return;
      uploadStatus.textContent = message;
      uploadStatus.className = `admin-upload-status${message ? ' is-visible' : ''}${type ? ` is-${type}` : ''}`;
    };

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const name = String(file.name || '').toLowerCase();
      const extension = name.includes('.') ? name.split('.').pop() : '';
      const declared = String(file.type || '').toLowerCase();
      // Android pickers sometimes report an empty type, image/jpg, or HEIC for
      // a normal JPEG. Let the bytes decide; only stop obvious non-images here.
      const knownExtension = ['jpg', 'jpeg', 'png', 'webp'].includes(extension);
      const knownType = !declared || ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(declared);
      if (!knownType && !knownExtension) {
        const heif = declared.includes('hei') || ['heic', 'heif'].includes(extension);
        setUploadStatus(
          heif
            ? 'HEIC/HEIF photos are not supported. Export the photo as JPEG and upload it again.'
            : 'Choose a JPEG, PNG or WebP image.',
          'error'
        );
        fileInput.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setUploadStatus('Images must be 5 MB or smaller.', 'error');
        fileInput.value = '';
        return;
      }
      uploadLabel?.classList.add('is-uploading');
      setUploadStatus('Uploading image…');
      const reader = new FileReader();
      reader.onerror = () => {
        uploadLabel?.classList.remove('is-uploading');
        setUploadStatus('The image could not be read. Try another file.', 'error');
        fileInput.value = '';
      };
      reader.onload = async () => {
        try {
          const base64 = String(reader.result || '').split(',')[1] || '';
          const result = await request('/api/admin/uploads', {
            method: 'POST',
            json: { filename: file.name, mime: file.type, data: base64 }
          });
          if (imageInput) {
            imageInput.value = result.path;
            updatePreview();
          }
          setUploadStatus('Uploaded. Save the product to publish it.', 'success');
          toast('Image uploaded.');
        } catch (error) {
          setUploadStatus(error.message, 'error');
        } finally {
          uploadLabel?.classList.remove('is-uploading');
          fileInput.value = '';
        }
      };
      reader.readAsDataURL(file);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const errorNode = $('[data-product-error]', form);
      const saveButton = $('[data-product-save]', form);
      const formData = new FormData(form);
      const compareAtRaw = String(formData.get('compareAt') || '').trim();
      const lines = (value) =>
        String(value || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      const details = lines(formData.get('details'));
      const specs = lines(formData.get('specs'))
        .map((line) => {
          const separator = line.indexOf(':');
          if (separator <= 0) return null;
          return { k: line.slice(0, separator).trim(), v: line.slice(separator + 1).trim() };
        })
        .filter((spec) => spec && spec.k && spec.v);
      const variants = lines(formData.get('variants'))
        .map((line) => {
          const separator = line.indexOf(':');
          if (separator <= 0) return null;
          const name = line.slice(0, separator).trim();
          const options = line
            .slice(separator + 1)
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean);
          return name && options.length ? { name, options } : null;
        })
        .filter(Boolean);
      const priceMode = modeInput?.value === 'manual' ? 'manual' : 'formula';
      const baseCost = numberOrNull(costInput);
      const profit = numberOrNull(profitInput);
      const price = effectivePrice();
      const payload = {
        name: String(formData.get('name') || '').trim(),
        category: String(formData.get('category') || ''),
        priceMode,
        baseCost,
        profit: profit === null ? 0 : profit,
        price,
        compareAt: compareAtRaw === '' ? null : Number(compareAtRaw),
        stock: Number(formData.get('stock')),
        badge: String(formData.get('badge') || '').trim(),
        image: String(formData.get('image') || '').trim(),
        short: String(formData.get('short') || '').trim(),
        description: String(formData.get('description') || '').trim(),
        details,
        specs,
        variants,
        featured: formData.get('featured') === 'on',
        isNew: formData.get('isNew') === 'on'
      };
      if (!Number.isInteger(payload.stock)) {
        if (errorNode) errorNode.textContent = 'Stock must be a whole number.';
        return;
      }
      if (payload.priceMode === 'formula' && payload.baseCost === null) {
        if (errorNode) errorNode.textContent = 'Formula pricing needs a base cost, or switch to a manual price.';
        return;
      }
      if (!Number.isFinite(payload.price) || payload.price < 1) {
        if (errorNode) errorNode.textContent = 'The selling price must be at least $1.';
        return;
      }
      if (payload.compareAt !== null && !(payload.compareAt > payload.price)) {
        // A compare-at at or below the selling price carries no meaning; drop
        // it instead of blocking the save.
        payload.compareAt = null;
      }
      if (errorNode) errorNode.textContent = '';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
      }
      const editingSlug = form.dataset.productSlug;
      try {
        if (editingSlug) {
          await request(`/api/admin/products/${encodeURIComponent(editingSlug)}`, { method: 'PATCH', json: payload });
          toast(`${payload.name} updated.`);
        } else {
          await request('/api/admin/products', { method: 'POST', json: payload });
          toast(`${payload.name} created.`);
        }
        closeModal();
        await loadProducts();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = editingSlug ? 'Save changes' : 'Create product';
        }
      }
    });

    $('[data-product-delete]', form)?.addEventListener('click', async () => {
      const slug = form.dataset.productSlug;
      const name = form.dataset.productName || 'this product';
      if (!slug) return;
      if (!window.confirm(`Delete ${name}? This removes it from the storefront. Existing orders keep their historical item data.`)) return;
      const button = $('[data-product-delete]', form);
      if (button) {
        button.disabled = true;
        button.textContent = 'Deleting…';
      }
      try {
        await request(`/api/admin/products/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        closeModal();
        toast(`${name} deleted.`);
        await loadProducts();
      } catch (error) {
        toast(error.message, true);
        if (button) {
          button.disabled = false;
          button.textContent = 'Delete';
        }
      }
    });
  }

  $('[data-add-product]')?.addEventListener('click', async () => {
    if (!state.products) {
      try {
        await loadProducts();
      } catch (error) {
        toast(error.message, true);
        return;
      }
    }
    openProductModal(null);
  });

  // ---------------------------------------------------------------- team

  function permissionChips(permissions) {
    const granted = PERMISSION_KEYS.filter((key) => permissions?.[key] === true);
    if (!granted.length) return '<span class="admin-muted">None</span>';
    return `<span class="perm-chips">${granted
      .map((key) => `<span class="perm-chip">${esc(PERMISSION_LABELS[key] || key)}</span>`)
      .join('')}</span>`;
  }

  async function loadStaff() {
    const data = await request('/api/admin/staff');
    state.staff = data.staff || [];
    renderStaff();
  }

  function renderStaff() {
    if (!els.staffTable || !state.staff) return;
    const term = (els.staffSearch?.value || '').trim().toLowerCase();
    const filtered = state.staff.filter((entry) => !term || `${entry.name} ${entry.username}`.toLowerCase().includes(term));
    if (els.staffCount) {
      els.staffCount.textContent = `${filtered.length} of ${state.staff.length} ${state.staff.length === 1 ? 'account' : 'accounts'}`;
    }
    if (!state.staff.length) {
      els.staffTable.innerHTML = emptyState(
        'No employee accounts',
        'Add a support agent and give them only the panels they need.'
      );
      return;
    }
    if (!filtered.length) {
      els.staffTable.innerHTML = emptyState('No matching accounts', 'Try a different name or username.');
      return;
    }
    els.staffTable.innerHTML = table(
      ['Employee', 'Role', 'Access', 'Chat scope', 'Added', 'Status', ''],
      filtered.map((entry) => {
        const admin = entry.role === 'admin';
        return `<tr>
          <td>
            <strong>${esc(entry.name)}</strong>
            <span class="admin-sub">@${esc(entry.username)}</span>
          </td>
          <td>${admin ? '<span class="admin-status admin-status--confirmed">Administrator</span>' : '<span class="admin-status admin-status--open">Employee</span>'}</td>
          <td class="perm-cell">${
            admin
              ? '<span class="admin-muted">Full access — set by the store owner</span>'
              : permissionChips(entry.permissions)
          }</td>
          <td>${admin ? '<span class="admin-muted">All chats</span>' : esc(entry.chatScope === 'assigned' ? 'Assigned only' : 'All chats')}</td>
          <td class="admin-nowrap">${esc(shortDate(entry.createdAt))}</td>
          <td>${entry.active === false ? '<span class="admin-status admin-status--cancelled">Disabled</span>' : '<span class="admin-status admin-status--active">Active</span>'}</td>
          <td class="admin-cell-action admin-cell-actions">
            <button class="admin-btn admin-btn--tiny" type="button" data-staff-edit="${esc(entry.id)}">Manage</button>
            <button class="admin-btn admin-btn--tiny" type="button" data-staff-password="${esc(entry.id)}">Reset password</button>
            <button class="admin-btn admin-btn--tiny" type="button" data-staff-active="${esc(entry.id)}" data-staff-next="${entry.active === false ? 'true' : 'false'}">${
              entry.active === false ? 'Enable' : 'Disable'
            }</button>
            ${admin ? '' : `<button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-staff-delete="${esc(entry.id)}" data-staff-name="${esc(entry.name)}">Delete</button>`}
          </td>
        </tr>`;
      })
    );
  }

  els.staffSearch?.addEventListener('input', renderStaff);

  function staffForm(entry = null) {
    const isEdit = Boolean(entry);
    const permissions = isEdit ? { ...SUPPORT_DEFAULT_PERMISSIONS(), ...(entry.permissions || {}) } : SUPPORT_DEFAULT_PERMISSIONS();
    const boxes = PERMISSION_KEYS.map(
      (key) => `<label class="admin-check perm-box">
        <input type="checkbox" name="perm-${esc(key)}"${permissions[key] ? ' checked' : ''}>
        <span>${esc(PERMISSION_LABELS[key] || key)}</span>
      </label>`
    ).join('');
    return `<form data-staff-form data-staff-id="${esc(entry?.id || '')}">
      <div class="admin-form-grid">
        <label class="admin-field">
          <span>Display name</span>
          <input class="admin-input" name="name" required minlength="2" maxlength="80" value="${esc(entry?.name || '')}">
          <small>Shown to customers in chat replies.</small>
        </label>
        <label class="admin-field">
          <span>Username</span>
          <input class="admin-input" name="username" required minlength="3" maxlength="40" pattern="[a-z0-9._-]{3,40}"
            value="${esc(entry?.username || '')}"${isEdit ? ' disabled' : ''} placeholder="j.doe">
          <small>${isEdit ? 'Usernames cannot be changed. 3–40 lowercase letters, numbers, dot, dash or underscore.' : '3–40 lowercase letters, numbers, dot, dash or underscore.'}</small>
        </label>
        <label class="admin-field">
          <span>${isEdit ? 'New password <em>leave blank to keep</em>' : 'Password'}</span>
          <input class="admin-input" name="password" type="password" minlength="10" maxlength="200"${isEdit ? '' : ' required'} autocomplete="new-password"
            placeholder="At least 10 characters">
        </label>
        <label class="admin-field">
          <span>Role</span>
          <input class="admin-input" value="${isEdit ? esc(entry.role === 'admin' ? 'Administrator' : 'Employee') : 'Employee'}" disabled>
          <small>Employee accounts are created as employees; administrators are provisioned by the store owner.</small>
        </label>
        <div class="admin-field admin-span-2">
          <span>Panel access</span>
          <div class="perm-grid">${boxes}</div>
          <div class="perm-help">
            <span class="admin-muted">New employees start with the support desk only: Live chat, Support tickets and Image uploads.</span>
            <button class="admin-text-btn" type="button" data-staff-support-defaults>Apply support defaults</button>
            <button class="admin-text-btn" type="button" data-staff-clear-permissions>Clear all</button>
          </div>
          <small>The Team panel stays administrator-only on the server, so granting it changes nothing for an employee.</small>
        </div>
        <label class="admin-field admin-span-2">
          <span>Live chat scope</span>
          <select class="admin-select" name="chatScope">
            <option value="all"${entry?.chatScope === 'assigned' ? '' : ' selected'}>Every conversation</option>
            <option value="assigned"${entry?.chatScope === 'assigned' ? ' selected' : ''}>Only their own and unclaimed conversations</option>
          </select>
        </label>
      </div>
      <p class="admin-form-error" role="alert" data-staff-error></p>
      <p class="admin-form-hint">Sessions are re-checked on every request, so a permission change takes effect the next time this account loads a panel.</p>
      <div class="om-actions">
        <span class="admin-actions-spacer"></span>
        <button class="admin-btn" type="button" data-modal-close>Cancel</button>
        <button class="admin-btn admin-btn--primary" type="submit" data-staff-save>${isEdit ? 'Save account' : 'Create employee'}</button>
      </div>
    </form>`;
  }

  function openStaffModal(entry = null) {
    openModal(entry ? `Manage — ${entry.name}` : 'Add employee', staffForm(entry));
    const form = $('[data-staff-form]', els.modalBody);
    if (!form) return;

    const setAll = (granted) => {
      PERMISSION_KEYS.forEach((key) => {
        const box = form.querySelector(`[name="perm-${key}"]`);
        if (box) box.checked = granted[key] === true;
      });
    };
    $('[data-staff-support-defaults]', form)?.addEventListener('click', () => {
      setAll(SUPPORT_DEFAULT_PERMISSIONS());
      toast('Support desk defaults applied.');
    });
    $('[data-staff-clear-permissions]', form)?.addEventListener('click', () => {
      const none = {};
      PERMISSION_KEYS.forEach((key) => {
        none[key] = false;
      });
      setAll(none);
      toast('All panel access cleared.');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const errorNode = $('[data-staff-error]', form);
      const saveButton = $('[data-staff-save]', form);
      const data = new FormData(form);
      const permissions = {};
      PERMISSION_KEYS.forEach((key) => {
        permissions[key] = data.get(`perm-${key}`) === 'on';
      });
      const password = String(data.get('password') || '');
      const id = form.dataset.staffId;
      const payload = {
        name: String(data.get('name') || '').trim(),
        permissions,
        chatScope: String(data.get('chatScope') || 'all')
      };
      if (!id) {
        payload.username = String(data.get('username') || '').trim().toLowerCase();
      }
      if (password) payload.password = password;
      if (!id && password.length < 10) {
        if (errorNode) errorNode.textContent = 'Password must be at least 10 characters.';
        return;
      }
      if (errorNode) errorNode.textContent = '';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
      }
      try {
        if (id) {
          await request(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', json: payload });
          toast(`${payload.name} updated.`);
        } else {
          await request('/api/admin/staff', { method: 'POST', json: payload });
          toast(`${payload.name} can now sign in to the panels you granted.`);
        }
        closeModal();
        await loadStaff();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = id ? 'Save account' : 'Create employee';
        }
      }
    });
  }

  $('[data-add-staff]')?.addEventListener('click', async () => {
    if (!isAdmin()) {
      toast('Only an administrator can manage employee accounts.', true);
      return;
    }
    try {
      if (!state.staff) await loadStaff();
    } catch (error) {
      toast(error.message, true);
      return;
    }
    openStaffModal(null);
  });

  async function patchStaff(id, body, label) {
    try {
      await request(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', json: body });
      toast(label);
      await loadStaff();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- tickets

  async function loadTickets() {
    const data = await request('/api/admin/tickets');
    state.tickets = data.tickets;
    renderTickets();
    updateBadges();
  }

  function renderTickets() {
    if (!els.ticketsList || !state.tickets) return;
    const filter = state.ticketFilter;
    const filtered = state.tickets.filter((ticket) => filter === 'all' || ticket.status === filter);
    if (els.ticketsCount) {
      const open = state.tickets.filter((ticket) => ticket.status === 'open').length;
      els.ticketsCount.textContent = `${filtered.length} shown · ${open} open`;
    }
    if (!filtered.length) {
      els.ticketsList.innerHTML = emptyState(
        filter === 'open' ? 'No open tickets' : 'No tickets here',
        filter === 'open' ? 'Customer messages appear here.' : 'Try another filter.'
      );
      return;
    }
    els.ticketsList.innerHTML = filtered.map((ticket) => {
      const thread = Array.isArray(ticket.thread) ? ticket.thread : [];
      const msgCount = thread.length;
      const hasUnread = ticket.status === 'open' && thread.length > 0 && thread[thread.length - 1].from === 'customer';
      return `<article class="ticket-card" id="tc-${esc(ticket.id)}">
        <div class="ticket-card__head">
          <div>
            <strong>${esc(ticket.name || ticket.email)}</strong>
            <span class="admin-sub">${esc(ticket.email)} · ${esc(ticket.id)} · ${esc(dateTime(ticket.createdAt))}${ticket.orderNumber ? ` · Order ${esc(ticket.orderNumber)}` : ''}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${!ticket.visitorId && !ticket.customerId ? '<span class="ticket-new-badge" title="No browser is attached to this thread, so the customer cannot see replies until they reopen the chat from /contact with their chat ID and phone.">Customer not connected</span>' : ''}
            ${hasUnread ? '<span class="ticket-new-badge">New message</span>' : ''}
            ${statusBadge(ticket.status === 'open' ? 'Open' : 'Resolved')}
          </div>
        </div>
        ${ticket.subject ? `<p class="ticket-card__subject">${esc(ticket.subject)}</p>` : ''}

        <div class="ticket-chat" id="chat-${esc(ticket.id)}">
          <div class="ticket-chat__messages" data-admin-chat-msgs="${esc(ticket.id)}">
            ${thread.length ? thread.map(msg => {
              const isCust = msg.from === 'customer';
              const pi = msg.paymentInfo;
              const hasPay = pi && (pi.upi || pi.binance || pi.crypto);
              return `<div class="achat-bubble ${isCust ? 'achat-bubble--customer' : 'achat-bubble--team'}">
                <div class="achat-meta">
                  <span>${esc(msg.senderName || (isCust ? 'Customer' : 'Team'))}</span>
                  <span>${esc(dateTime(msg.at))}</span>
                </div>
                <div class="achat-text">${esc(msg.text).replace(/\n/g,'<br>')}</div>
                ${hasPay ? `<div class="achat-payment">
                  <strong>💳 Payment details sent to customer</strong>
                  ${pi.upi     ? `<div>UPI: ${esc(pi.upi)}</div>`     : ''}
                  ${pi.binance ? `<div>Binance: ${esc(pi.binance)}</div>` : ''}
                  ${pi.crypto  ? `<div>Crypto: ${esc(pi.crypto)}</div>`  : ''}
                  ${pi.label   ? `<div><em>${esc(pi.label)}</em></div>`  : ''}
                </div>` : ''}
              </div>`;
            }).join('') : '<p class="achat-empty">No messages yet.</p>'}
          </div>

          <form class="achat-reply-form" data-admin-reply="${esc(ticket.id)}" novalidate>
            <textarea class="admin-input achat-input" rows="2" placeholder="Type reply…" name="replyText" required></textarea>

            <details class="achat-pay-toggle">
              <summary>+ Attach payment details (UPI / Binance / Crypto)</summary>
              <div class="achat-pay-fields">
                <div><label class="admin-label">UPI ID</label><input class="admin-input" type="text" name="upi" placeholder="name@upi or 9876543210@paytm"></div>
                <div><label class="admin-label">Binance UID / Pay ID</label><input class="admin-input" type="text" name="binance" placeholder="Binance UID"></div>
                <div><label class="admin-label">Crypto Address</label><input class="admin-input" type="text" name="crypto" placeholder="USDT TRC20 / BTC address"></div>
                <div><label class="admin-label">Note to customer</label><input class="admin-input" type="text" name="payLabel" placeholder="e.g. USDT TRC20 only — send exact amount"></div>
              </div>
            </details>

            <div class="achat-reply-foot">
              <label class="admin-label" style="font-size:10px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" name="resolveAfter"> Mark resolved after sending
              </label>
              <p class="admin-form-error" data-achat-error-${esc(ticket.id)}></p>
              <button class="admin-btn admin-btn--primary admin-btn--tiny" type="submit">
                Send
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </form>

          <div class="ticket-card__actions">
            <a class="admin-btn admin-btn--tiny" href="mailto:${encodeURIComponent(ticket.email)}?subject=${encodeURIComponent(`Re: ${ticket.id} — VELUNE`)}">Email customer</a>
            <button class="admin-btn admin-btn--tiny${ticket.status === 'open' ? ' admin-btn--primary' : ''}" type="button" data-ticket-toggle="${esc(ticket.id)}" data-ticket-next="${ticket.status === 'open' ? 'resolved' : 'open'}">
              ${ticket.status === 'open' ? 'Mark resolved' : 'Reopen'}
            </button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  $$('[data-ticket-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.ticketFilter = button.dataset.ticketFilter;
      $$('[data-ticket-filter]').forEach((entry) => entry.classList.toggle('is-active', entry === button));
      renderTickets();
    });
  });

  // Admin chat reply form submit (delegated)
  els.ticketsList?.addEventListener('submit', (event) => {
    const replyForm = event.target.closest('[data-admin-reply]');
    if (!replyForm) return;
    event.preventDefault();
    sendAdminReply(replyForm.dataset.adminReply, replyForm);
  });

  async function toggleTicket(id, nextStatus, button) {
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const data = await request(`/api/admin/tickets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        json: { status: nextStatus }
      });
      const index = state.tickets.findIndex((ticket) => ticket.id === id);
      if (index >= 0) state.tickets[index] = data.ticket;
      renderTickets();
      updateBadges();
      toast(nextStatus === 'resolved' ? 'Ticket marked resolved.' : 'Ticket reopened.');
    } catch (error) {
      toast(error.message, true);
      if (button) {
        button.disabled = false;
        button.textContent = nextStatus === 'resolved' ? 'Mark resolved' : 'Reopen';
      }
    }
  }

  async function sendAdminReply(id, formEl) {
    const replyText = formEl.querySelector('[name="replyText"]')?.value?.trim() || '';
    if (!replyText) return;
    const upi       = formEl.querySelector('[name="upi"]')?.value?.trim()       || '';
    const binance   = formEl.querySelector('[name="binance"]')?.value?.trim()   || '';
    const crypto    = formEl.querySelector('[name="crypto"]')?.value?.trim()    || '';
    const payLabel  = formEl.querySelector('[name="payLabel"]')?.value?.trim()  || '';
    const resolveAfter = formEl.querySelector('[name="resolveAfter"]')?.checked;
    const errorNode = document.querySelector(`[data-achat-error-${id}]`);
    if (errorNode) errorNode.textContent = '';
    const submitBtn = formEl.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
    try {
      const payload = {
        replyText,
        paymentInfo: { upi, binance, crypto, label: payLabel },
        ...(resolveAfter ? { status: 'resolved' } : {})
      };
      const data = await request(`/api/admin/tickets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        json: payload
      });
      const index = state.tickets.findIndex((t) => t.id === id);
      if (index >= 0) state.tickets[index] = data.ticket;
      // Update just this card's messages without full re-render
      const msgsEl = document.querySelector(`[data-admin-chat-msgs="${id}"]`);
      if (msgsEl && data.ticket.thread) {
        const thread = data.ticket.thread;
        msgsEl.innerHTML = thread.map(msg => {
          const isCust = msg.from === 'customer';
          const pi = msg.paymentInfo;
          const hasPay = pi && (pi.upi || pi.binance || pi.crypto);
          return `<div class="achat-bubble ${isCust ? 'achat-bubble--customer' : 'achat-bubble--team'}">
            <div class="achat-meta"><span>${esc(msg.senderName||'')}</span><span>${esc(dateTime(msg.at))}</span></div>
            <div class="achat-text">${esc(msg.text).replace(/\n/g,'<br>')}</div>
            ${hasPay ? `<div class="achat-payment">
              <strong>💳 Payment details sent</strong>
              ${pi.upi     ? `<div>UPI: ${esc(pi.upi)}</div>`     : ''}
              ${pi.binance ? `<div>Binance: ${esc(pi.binance)}</div>` : ''}
              ${pi.crypto  ? `<div>Crypto: ${esc(pi.crypto)}</div>`  : ''}
              ${pi.label   ? `<div><em>${esc(pi.label)}</em></div>`  : ''}
            </div>` : ''}
          </div>`;
        }).join('');
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      formEl.reset();
      updateBadges();
      toast('Reply sent.');
      if (resolveAfter) renderTickets();
    } catch (error) {
      if (errorNode) errorNode.textContent = error.message;
      toast(error.message, true);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send ➤'; }
    }
  }

  // ---------------------------------------------------------------- customers

  async function loadCustomers() {
    const data = await request('/api/admin/customers');
    state.customers = data.customers;
    renderCustomers();
  }

  function renderCustomers() {
    if (!els.customersTable || !state.customers) return;
    const term = (els.customerSearch?.value || '').trim().toLowerCase();
    const filtered = state.customers.filter((customer) => {
      if (!term) return true;
      return `${customer.firstName} ${customer.lastName} ${customer.email}`.toLowerCase().includes(term);
    });
    if (els.customersCount) {
      els.customersCount.textContent = `${filtered.length} of ${state.customers.length} ${
        state.customers.length === 1 ? 'customer' : 'customers'
      }`;
    }
    if (!state.customers.length) {
      els.customersTable.innerHTML = emptyState(
        'No accounts yet',
        'Customers who register on the storefront will appear here. Guest orders are still visible under Orders.'
      );
      return;
    }
    if (!filtered.length) {
      els.customersTable.innerHTML = emptyState('No matching customers', 'Try a different name or email search.');
      return;
    }
    els.customersTable.innerHTML = table(
      ['Customer', 'Joined', 'Orders', 'Spent', ''],
      filtered.map(
        (customer) => `<tr>
          <td>
            <strong>${esc(`${customer.firstName} ${customer.lastName}`.trim())}</strong>
            <span class="admin-sub">${esc(customer.email)}</span>
          </td>
          <td class="admin-nowrap">${esc(shortDate(customer.createdAt))}</td>
          <td class="admin-num">${Number(customer.orderCount) || 0}</td>
          <td class="admin-num">${money(customer.spent)}</td>
          <td class="admin-cell-action admin-cell-actions">
            <button class="admin-btn admin-btn--tiny" type="button" data-customer-orders="${esc(customer.email)}">Orders</button>
            <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-customer-delete="${esc(customer.id)}" data-customer-email="${esc(customer.email)}">Delete</button>
          </td>
        </tr>`
      )
    );
  }

  els.customerSearch?.addEventListener('input', renderCustomers);

  async function deleteCustomer(id, email) {
    if (!id) return;
    if (
      !window.confirm(
        `Delete the account for ${email}? Their orders are kept for records, but the account and order-history access are removed. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await request(`/api/admin/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.customers = state.customers.filter((customer) => customer.id !== id);
      renderCustomers();
      toast(`Account for ${email} deleted.`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- stores

  const STORE_STATUS_LABEL = {
    draft: 'Draft',
    pending: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
    suspended: 'Suspended'
  };

  async function loadStores() {
    const data = await request('/api/admin/stores');
    state.stores = data.stores || [];
    renderStores();
  }

  function renderStores() {
    if (!els.storesTable || !state.stores) return;
    const term = (els.storeSearch?.value || '').trim().toLowerCase();
    const filtered = state.stores.filter((entry) => {
      if (!term) return true;
      return `${entry.name} ${entry.slug} ${entry.owner?.name || ''} ${entry.owner?.email || ''}`.toLowerCase().includes(term);
    });
    if (els.storesCount) {
      els.storesCount.textContent = `${filtered.length} of ${state.stores.length} ${state.stores.length === 1 ? 'store' : 'stores'}`;
    }
    if (!state.stores.length) {
      els.storesTable.innerHTML = emptyState(
        'No stores yet',
        'Verified customers can create a storefront from their account page and submit it here for approval.'
      );
      return;
    }
    if (!filtered.length) {
      els.storesTable.innerHTML = emptyState('No matching stores', 'Try a different store name, owner or address.');
      return;
    }
    els.storesTable.innerHTML = table(
      ['Store', 'Owner', 'Status', 'Items', 'Units', ''],
      filtered.map((entry) => {
        const actions = [];
        if (['draft', 'pending', 'rejected'].includes(entry.status)) {
          actions.push(`<button class="admin-btn admin-btn--tiny admin-btn--primary" type="button" data-store-action="approve" data-store-id="${esc(entry.id)}" data-store-name="${esc(entry.name)}">Approve</button>`);
          actions.push(`<button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-store-action="reject" data-store-id="${esc(entry.id)}" data-store-name="${esc(entry.name)}">Reject</button>`);
        }
        if (entry.status === 'approved') {
          actions.push(`<button class="admin-btn admin-btn--tiny" type="button" data-store-action="suspend" data-store-id="${esc(entry.id)}" data-store-name="${esc(entry.name)}">Suspend</button>`);
        }
        if (entry.status === 'suspended') {
          actions.push(`<button class="admin-btn admin-btn--tiny admin-btn--primary" type="button" data-store-action="reinstate" data-store-id="${esc(entry.id)}" data-store-name="${esc(entry.name)}">Reinstate</button>`);
        }
        if (entry.live) {
          actions.push(`<a class="admin-btn admin-btn--tiny admin-btn--outline" href="/store/${esc(entry.slug)}" target="_blank" rel="noopener">Visit</a>`);
        }
        return `<tr>
          <td>
            <strong>${esc(entry.name)}</strong>
            <span class="admin-sub">/store/${esc(entry.slug)}</span>
            ${entry.reviewNote ? `<span class="admin-sub">${esc(entry.reviewNote)}</span>` : ''}
          </td>
          <td>
            <strong>${esc(entry.owner?.name || 'Account removed')}</strong>
            <span class="admin-sub">${esc(entry.owner?.email || '')}${entry.owner?.kycStatus ? ` · ${esc(entry.owner.kycStatus)}` : ''}</span>
          </td>
          <td><span class="admin-status admin-status--${esc(entry.status)}">${esc(STORE_STATUS_LABEL[entry.status] || entry.status)}</span></td>
          <td class="admin-num">${Number(entry.publishedCount) || 0} / ${Number(entry.itemCount) || 0}</td>
          <td class="admin-num">${Number(entry.unitCount) || 0}</td>
          <td class="admin-cell-action admin-cell-actions">${actions.join('')}</td>
        </tr>`;
      })
    );
  }

  els.storeSearch?.addEventListener('input', renderStores);

  els.storesTable?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-store-action]');
    if (!button) return;
    const action = button.dataset.storeAction;
    const name = button.dataset.storeName || 'this store';
    let note = '';
    if (action === 'reject' || action === 'suspend') {
      const entered = window.prompt(
        action === 'reject'
          ? `Why is ${name} being rejected? The owner sees this note.`
          : `Why is ${name} being suspended? The owner sees this note.`,
        ''
      );
      if (entered === null) return;
      note = entered.trim();
      if (!note) {
        toast('Add a short note so the owner knows what to fix.', true);
        return;
      }
    }
    if (action === 'suspend' && !window.confirm(`Suspend ${name}? The public storefront goes offline immediately.`)) return;
    button.disabled = true;
    try {
      const result = await request(`/api/admin/stores/${encodeURIComponent(button.dataset.storeId)}`, {
        method: 'PATCH',
        json: { action, note }
      });
      toast(result.message || 'Store updated.');
      await loadStores();
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });

  // ---------------------------------------------------------------- integrations

  function integrationProvider(provider) {
    return (state.integrationProviders || []).find((entry) => entry.key === provider) || null;
  }

  function findIntegration(id) {
    return (state.integrations || []).find((entry) => entry.id === id) || null;
  }

  function integrationEndpoint(entry) {
    const config = entry.config || {};
    if (entry.provider === 'shopify') return config.shop || '';
    if (entry.provider === 'woocommerce') return config.siteUrl || '';
    return config.baseUrl || '';
  }

  function integrationLabel(id) {
    return findIntegration(id)?.name || 'Removed channel';
  }

  async function loadIntegrations() {
    const data = await request('/api/admin/integrations');
    state.integrations = data.integrations || [];
    state.integrationProviders = data.providers || [];
    state.integrationJobs = data.jobs || [];
    renderIntegrations();
    renderIntegrationJobs();
  }

  function renderIntegrations() {
    if (!els.integrationsList) return;
    const list = state.integrations || [];
    if (els.integrationsCount) {
      els.integrationsCount.textContent = `${list.length} ${list.length === 1 ? 'channel' : 'channels'}`;
    }
    if (!list.length) {
      els.integrationsList.innerHTML = emptyState(
        'No sales channels connected',
        'Connect a Shopify or WooCommerce store, or a supplier API, to import stock and send fulfilment orders.',
        '<button class="admin-btn admin-btn--primary" type="button" data-integration-add>Connect channel</button>'
      );
      return;
    }
    els.integrationsList.innerHTML = list.map((entry) => {
      const statusClass = !entry.active
        ? 'cancelled'
        : entry.lastTestStatus === 'success'
          ? 'active'
          : entry.lastTestStatus === 'error'
            ? 'failed'
            : 'pending';
      const statusText = !entry.active
        ? 'Inactive'
        : entry.lastTestStatus === 'success'
          ? 'Connected'
          : entry.lastTestStatus === 'error'
            ? 'Test failed'
            : 'Not tested';
      const linkCount = Number(entry.linkCount) || 0;
      return `<article class="integration-card">
        <header class="integration-card__head">
          <div>
            <strong>${esc(entry.name)}</strong>
            <span class="admin-sub">${esc(entry.providerLabel)}${integrationEndpoint(entry) ? ` · ${esc(integrationEndpoint(entry))}` : ''}</span>
          </div>
          <span class="admin-status admin-status--${statusClass}">${statusText}</span>
        </header>
        <div class="integration-card__stats">
          <div><span>Linked products</span><strong>${linkCount}</strong></div>
          <div><span>Last test</span><strong>${entry.lastTestAt ? esc(dateTime(entry.lastTestAt)) : '—'}</strong></div>
          <div><span>Last sync</span><strong>${entry.lastLinkedAt ? esc(dateTime(entry.lastLinkedAt)) : '—'}</strong></div>
        </div>
        ${entry.lastJob ? `<p class="integration-card__job"><span class="admin-status admin-status--${entry.lastJob.status === 'error' ? 'failed' : entry.lastJob.status === 'success' ? 'active' : 'pending'}">${esc(entry.lastJob.status)}</span> ${esc(entry.lastJob.message)}</p>` : ''}
        <div class="integration-card__actions">
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="edit" data-integration-id="${esc(entry.id)}">Edit</button>
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="test" data-integration-id="${esc(entry.id)}">Test</button>
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="import" data-integration-id="${esc(entry.id)}" ${entry.ready ? '' : 'disabled'}>Import products</button>
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="export" data-integration-id="${esc(entry.id)}">Export products</button>
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="sync" data-integration-id="${esc(entry.id)}" ${linkCount ? '' : 'disabled'}>Sync stock</button>
          <button class="admin-btn admin-btn--tiny" type="button" data-integration-action="orders" data-integration-id="${esc(entry.id)}" ${linkCount ? '' : 'disabled'}>Send orders</button>
          <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-integration-action="delete" data-integration-id="${esc(entry.id)}">Remove</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderIntegrationJobs() {
    if (!els.integrationJobs) return;
    const jobs = state.integrationJobs || [];
    if (!jobs.length) {
      els.integrationJobs.innerHTML = emptyState('No channel activity yet', 'Tests, imports, exports and stock syncs are logged here.');
      return;
    }
    els.integrationJobs.innerHTML = table(
      ['When', 'Channel', 'Action', 'Result'],
      jobs.map((job) => `<tr>
        <td>${esc(dateTime(job.createdAt))}</td>
        <td>${esc(integrationLabel(job.integrationId))}</td>
        <td>${esc(String(job.type || '').replace(/-/g, ' '))}</td>
        <td>
          <span class="admin-status admin-status--${job.status === 'error' ? 'failed' : job.status === 'success' ? 'active' : 'pending'}">${esc(job.status)}</span>
          <span class="admin-sub">${esc(job.message)}</span>
        </td>
      </tr>`)
    );
  }

  function integrationFieldsHtml(provider, integration = null) {
    const def = integrationProvider(provider);
    if (!def) return '<p class="admin-form-hint">Choose a provider to see its settings.</p>';
    return def.fields.map((field) => {
      const savedSecret = Boolean(field.secret && integration?.secrets?.[field.key]);
      const fallback = field.secret ? '' : (def.defaults?.[field.key] ?? '');
      const value = field.secret ? '' : (integration?.config?.[field.key] ?? fallback);
      const placeholder = savedSecret ? 'Saved — leave blank to keep' : (field.placeholder || '');
      return `<label class="admin-field">
        <span>${esc(field.label)}${field.required ? '' : ' <em>optional</em>'}</span>
        <input class="admin-input" data-integration-field="${esc(field.key)}" type="${field.secret ? 'password' : 'text'}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="500" autocomplete="off">
        <small>${esc(field.help || '')}</small>
      </label>`;
    }).join('');
  }

  function openIntegrationForm(integration = null) {
    if (!state.integrationProviders?.length) {
      toast('Channel providers are still loading. Refresh and try again.', true);
      return;
    }
    const selected = integration?.provider || state.integrationProviders[0].key;
    const options = state.integrationProviders
      .map((provider) => `<option value="${esc(provider.key)}"${provider.key === selected ? ' selected' : ''}>${esc(provider.label)}</option>`)
      .join('');
    openModal(integration ? 'Edit sales channel' : 'Connect a sales channel', `
      <form data-integration-form novalidate>
        <div class="admin-form-grid">
          <label class="admin-field">
            <span>Provider</span>
            <select class="admin-select" data-integration-provider${integration ? ' disabled' : ''}>${options}</select>
          </label>
          <label class="admin-field">
            <span>Channel name</span>
            <input class="admin-input" data-integration-name maxlength="60" value="${esc(integration?.name || '')}" placeholder="Main Shopify store">
          </label>
          <div class="admin-span-2 integration-fields" data-integration-fields>${integrationFieldsHtml(selected, integration)}</div>
        </div>
        <label class="integration-active">
          <input type="checkbox" data-integration-active${integration?.active === false ? '' : ' checked'}>
          <span>Active — include this channel in stock and order actions</span>
        </label>
        <p class="admin-form-error" role="alert" data-integration-error></p>
        <div class="om-actions">
          <span class="admin-muted">${integration ? 'Leave a saved credential blank to keep it.' : 'Credentials are encrypted before they are stored.'}</span>
          <span class="admin-actions-spacer"></span>
          <button class="admin-btn admin-btn--outline" type="button" data-modal-close>Cancel</button>
          <button class="admin-btn admin-btn--primary" type="submit">${integration ? 'Save channel' : 'Connect channel'}</button>
        </div>
      </form>
    `);
    const form = $('[data-integration-form]', els.modalBody);
    if (!form) return;
    const providerSelect = $('[data-integration-provider]', form);
    providerSelect?.addEventListener('change', () => {
      const container = $('[data-integration-fields]', form);
      if (container) container.innerHTML = integrationFieldsHtml(providerSelect.value, null);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('button[type="submit"]', form);
      const errorNode = $('[data-integration-error]', form);
      const config = {};
      form.querySelectorAll('[data-integration-field]').forEach((input) => {
        config[input.dataset.integrationField] = input.value;
      });
      const payload = {
        id: integration?.id,
        provider: providerSelect?.value || selected,
        name: $('[data-integration-name]', form)?.value.trim() || '',
        active: Boolean($('[data-integration-active]', form)?.checked),
        config
      };
      if (errorNode) errorNode.textContent = '';
      if (submit) { submit.disabled = true; submit.textContent = 'Saving…'; }
      try {
        const result = await request('/api/admin/integrations', { method: 'POST', json: payload });
        closeModal();
        toast(result.message || 'Channel saved.');
        await loadIntegrations();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        if (submit) { submit.disabled = false; submit.textContent = integration ? 'Save channel' : 'Connect channel'; }
      }
    });
  }

  async function runIntegrationCall(button, runningLabel, call) {
    if (!button) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = runningLabel;
    try {
      const result = await call();
      toast(result.message || 'Channel action complete.');
      await loadIntegrations();
    } catch (error) {
      toast(error.message, true);
      await loadIntegrations().catch(() => {});
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function wireChannelPicker({ picker, countNode, submit, errorNode, search, max, runLabel, submitLabel, onRun }) {
    const boxes = () => [...picker.querySelectorAll('input[data-pick]')];
    const chosen = () => boxes().filter((box) => box.checked && !box.disabled).map((box) => box.value);
    function sync() {
      const picks = chosen();
      if (countNode) countNode.textContent = picks.length ? `${picks.length} selected${picks.length >= max ? ' — maximum' : ''}` : '0 selected';
      if (submit) submit.disabled = picks.length === 0;
    }
    picker.addEventListener('change', (event) => {
      if (event.target.matches('input[data-pick]') && chosen().length > max) {
        event.target.checked = false;
        toast(`Choose up to ${max}.`, true);
      }
      sync();
    });
    search?.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      picker.querySelectorAll('[data-pick-row]').forEach((row) => {
        row.hidden = Boolean(term) && !String(row.dataset.pickRow || '').includes(term);
      });
    });
    submit?.addEventListener('click', async () => {
      const picks = chosen();
      if (!picks.length) return;
      submit.disabled = true;
      submit.textContent = runLabel;
      try {
        const result = await onRun(picks);
        closeModal();
        toast(result.message || 'Done.');
        await loadIntegrations();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });
    sync();
  }

  async function openIntegrationExport(entry) {
    let data;
    try {
      data = await request('/api/admin/integrations/catalog');
    } catch (error) {
      toast(error.message, true);
      return;
    }
    state.integrationCatalog = data.products || [];
    const rows = state.integrationCatalog.map((product) => {
      const linked = (product.links || []).find((link) => link.integrationId === entry.id);
      return `<label class="int-picker__row" data-pick-row="${esc(`${product.name} ${product.slug}`.toLowerCase())}">
        <input type="checkbox" data-pick value="${esc(product.slug)}">
        <span class="int-picker__name">${esc(product.name)}${linked ? '<em class="int-picker__linked">Linked</em>' : ''}<span class="admin-sub">${esc(product.categoryName)}</span></span>
        <span class="int-picker__meta">${money(product.price)} · ${Number(product.stock) || 0} in stock</span>
      </label>`;
    }).join('');
    openModal(`Export products to ${entry.name}`, `
      <p class="admin-form-hint">Choose up to 25 products. Products already linked are updated rather than duplicated.</p>
      <div class="int-picker__toolbar">
        <input class="admin-input" type="search" placeholder="Filter products…" aria-label="Filter products to export" data-pick-search>
      </div>
      <div class="int-picker" data-pick-list>${rows || '<p class="admin-muted admin-pad">No products to export.</p>'}</div>
      <p class="admin-form-error" role="alert" data-pick-error></p>
      <div class="om-actions">
        <span class="admin-muted" data-pick-count>0 selected</span>
        <span class="admin-actions-spacer"></span>
        <button class="admin-btn admin-btn--outline" type="button" data-modal-close>Cancel</button>
        <button class="admin-btn admin-btn--primary" type="button" data-pick-submit disabled>Export selected</button>
      </div>
    `);
    const picker = $('[data-pick-list]', els.modalBody);
    if (!picker) return;
    wireChannelPicker({
      picker,
      countNode: $('[data-pick-count]', els.modalBody),
      submit: $('[data-pick-submit]', els.modalBody),
      errorNode: $('[data-pick-error]', els.modalBody),
      search: $('[data-pick-search]', els.modalBody),
      max: 25,
      runLabel: 'Exporting…',
      submitLabel: 'Export selected',
      onRun: (slugs) => request(`/api/admin/integrations/${entry.id}/export-products`, { method: 'POST', json: { slugs } })
    });
  }

  async function openIntegrationOrders(entry) {
    let data;
    try {
      data = await request('/api/admin/orders');
    } catch (error) {
      toast(error.message, true);
      return;
    }
    const orders = (data.orders || [])
      .filter((order) => order.status !== 'Cancelled')
      .slice(0, 30);
    const rows = orders.map((order) => {
      const sent = order.integrationOrders?.[entry.id];
      const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || order.customer?.email || 'Customer';
      return `<label class="int-picker__row" data-pick-row="${esc(`${order.number} ${customerName} ${order.customer?.email || ''}`.toLowerCase())}">
        <input type="checkbox" data-pick value="${esc(order.number)}" ${sent ? 'disabled data-locked="1"' : ''}>
        <span class="int-picker__name">${esc(order.number)}<span class="admin-sub">${esc(customerName)} · ${esc(order.status)}</span></span>
        <span class="int-picker__meta">${money(order.total)}${sent ? ` · sent as ${esc(sent.externalName || sent.externalId)}` : ''}</span>
      </label>`;
    }).join('');
    openModal(`Send orders to ${entry.name}`, `
      <p class="admin-form-hint">Choose up to 20 orders. Cancelled orders and orders already sent to this channel are excluded. Each order is only created remotely once.</p>
      <div class="int-picker__toolbar">
        <input class="admin-input" type="search" placeholder="Filter by order or customer…" aria-label="Filter orders" data-pick-search>
      </div>
      <div class="int-picker" data-pick-list>${rows || '<p class="admin-muted admin-pad">No open orders right now.</p>'}</div>
      <p class="admin-form-error" role="alert" data-pick-error></p>
      <div class="om-actions">
        <span class="admin-muted" data-pick-count>0 selected</span>
        <span class="admin-actions-spacer"></span>
        <button class="admin-btn admin-btn--outline" type="button" data-modal-close>Cancel</button>
        <button class="admin-btn admin-btn--primary" type="button" data-pick-submit disabled>Send selected</button>
      </div>
    `);
    const picker = $('[data-pick-list]', els.modalBody);
    if (!picker) return;
    wireChannelPicker({
      picker,
      countNode: $('[data-pick-count]', els.modalBody),
      submit: $('[data-pick-submit]', els.modalBody),
      errorNode: $('[data-pick-error]', els.modalBody),
      search: $('[data-pick-search]', els.modalBody),
      max: 20,
      runLabel: 'Sending…',
      submitLabel: 'Send selected',
      onRun: (numbers) => request(`/api/admin/integrations/${entry.id}/push-orders`, { method: 'POST', json: { numbers } })
    });
  }

  document.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-integration-add]');
    if (add) {
      event.preventDefault();
      openIntegrationForm(null);
      return;
    }
    const trigger = event.target.closest('[data-integration-action]');
    if (!trigger) return;
    const entry = findIntegration(trigger.dataset.integrationId);
    if (!entry) {
      toast('That channel was removed. Refresh the list.', true);
      return;
    }
    const action = trigger.dataset.integrationAction;
    if (action === 'edit') {
      openIntegrationForm(entry);
      return;
    }
    if (action === 'test') {
      await runIntegrationCall(trigger, 'Testing…', () => request(`/api/admin/integrations/${entry.id}/test`, { method: 'POST' }));
      return;
    }
    if (action === 'import') {
      if (!window.confirm(`Import up to 40 products from ${entry.name}? Linked products keep their page and have price and stock refreshed.`)) return;
      await runIntegrationCall(trigger, 'Importing…', () => request(`/api/admin/integrations/${entry.id}/import-products`, { method: 'POST', json: { limit: 40 } }));
      return;
    }
    if (action === 'export') {
      await openIntegrationExport(entry);
      return;
    }
    if (action === 'sync') {
      if (!window.confirm(`Send current price and stock for ${entry.linkCount} linked product${Number(entry.linkCount) === 1 ? '' : 's'} to ${entry.name}?`)) return;
      await runIntegrationCall(trigger, 'Syncing…', () => request(`/api/admin/integrations/${entry.id}/sync-inventory`, { method: 'POST', json: {} }));
      return;
    }
    if (action === 'orders') {
      await openIntegrationOrders(entry);
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`Remove ${entry.name}? Saved credentials and product links are deleted. Local products and orders stay.`)) return;
      await runIntegrationCall(trigger, 'Removing…', () => request(`/api/admin/integrations/${entry.id}`, { method: 'DELETE' }));
    }
  });

  // ---------------------------------------------------------------- reports

  const dayLabel = (day) => {
    const text = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || '—';
    return shortDate(`${text}T00:00:00`);
  };

  // Costs and prices in the desk are USD (the catalogue base currency); the
  // rupee line is the shopper-facing equivalent from the saved currency config.
  function inrLine(usd, currency) {
    const rate = Number(currency?.inrPerUsd);
    const symbol = String(currency?.symbolInr || '');
    if (!Number.isFinite(rate) || rate <= 0 || !symbol) return '';
    const value = Math.round((Number(usd) || 0) * rate);
    return `<span class="rp-tile__alt">${esc(symbol)}${esc(value.toLocaleString('en-IN'))}</span>`;
  }

  async function loadReports() {
    const report = await request(`/api/admin/reports/profit?range=${encodeURIComponent(state.reportRange)}`);
    report.rangeLabel =
      report.range === 'all' ? 'all time' : String(report.range || '').replace(/d$/, ' days');
    state.report = report;
    state.reportRows = 40;
    try {
      state.expenses = await request('/api/admin/expenses');
    } catch {
      state.expenses = null;
    }
    renderReports();
  }

  function renderReports() {
    if (!state.report) return;
    renderReportTiles();
    renderReportChart();
    renderReportProducts();
    renderPaymentMix();
    renderExpenses();
  }

  function renderReportTiles() {
    if (!els.reportTiles) return;
    const report = state.report;
    const totals = report.totals || {};
    const currency = report.currency || {};
    const tiles = [
      {
        label: 'Revenue',
        value: money(totals.revenue),
        alt: inrLine(totals.revenue, currency),
        note: `${Number(totals.orders) || 0} orders · AOV ${money(totals.aov)}${Number(totals.shippingCollected) ? ` · shipping ${money(totals.shippingCollected)}` : ''}`
      },
      {
        label: 'Gross profit',
        value: money(totals.profit),
        alt: inrLine(totals.profit, currency),
        note: `Margin ${Number(totals.margin) || 0}% on ${money(totals.trackedRevenue || 0)} tracked${
          Number(totals.untrackedRevenue) ? ` · ${money(totals.untrackedRevenue)} untracked` : ''
        }`
      },
      {
        label: 'Expenses',
        value: money(report.expenses?.total),
        alt: inrLine(report.expenses?.total, currency),
        note: `${Number(report.expenses?.entries) || 0} entries recorded · discounts ${money(totals.discountsGiven)}`
      },
      {
        label: 'Net profit',
        value: money(report.netProfit),
        alt: inrLine(report.netProfit, currency),
        note: 'Gross product margin after operating expenses',
        negative: Number(report.netProfit) < 0
      }
    ];
    els.reportTiles.innerHTML = tiles
      .map(
        (tile) => `<article class="stat-card${tile.negative ? ' stat-card--attention' : ''}">
          <span class="stat-card__label">${esc(tile.label)} · ${esc(report.rangeLabel)}</span>
          <strong class="stat-card__value">${esc(tile.value)}</strong>
          ${tile.alt || ''}
          <span class="stat-card__note">${esc(tile.note)}</span>
        </article>`
      )
      .join('');
    if (els.reportWindow) {
      els.reportWindow.textContent = report.from
        ? `From ${dayLabel(String(report.from).slice(0, 10))} to today · prices shown in ${currency.display || 'USD'} (base ${currency.base || 'USD'})`
        : `All time · prices shown in ${currency.display || 'USD'} (base ${currency.base || 'USD'})`;
    }
  }

  // More than a month of daily bars becomes unreadable, so longer ranges are
  // folded into at most 31 buckets and labelled with the span they cover.
  function chartBuckets(daily) {
    const rows = Array.isArray(daily) ? daily : [];
    if (rows.length <= 31) return rows.map((row) => ({ ...row, span: 1 }));
    const size = Math.ceil(rows.length / 31);
    const buckets = [];
    for (let index = 0; index < rows.length; index += size) {
      const slice = rows.slice(index, index + size);
      buckets.push({
        day: slice[slice.length - 1].day,
        from: slice[0].day,
        span: slice.length,
        orders: slice.reduce((sum, row) => sum + (Number(row.orders) || 0), 0),
        revenue: slice.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0),
        profit: slice.reduce((sum, row) => sum + (Number(row.profit) || 0), 0)
      });
    }
    return buckets;
  }

  function renderReportChart() {
    if (!els.reportChart) return;
    const daily = state.report.daily || [];
    if (!daily.length) {
      els.reportChart.innerHTML = emptyState(
        'No orders in this window',
        'The daily revenue and profit bars appear once an order is placed in the selected range.'
      );
      return;
    }
    const buckets = chartBuckets(daily);
    const peak = Math.max(...buckets.map((row) => Number(row.revenue) || 0), 1);
    els.reportChart.innerHTML = `<div class="rp-chart__scroll">
      <div class="rp-chart__grid" role="img" aria-label="${buckets.length} bars of daily revenue and profit, peak ${money(peak)}">
        ${buckets
          .map(
            (row) => `<div class="rp-col" title="${esc(dayLabel(row.from || row.day))}${row.span > 1 ? ` – ${esc(dayLabel(row.day))}` : ''} · ${
              Number(row.orders) || 0
            } ${Number(row.orders) === 1 ? 'order' : 'orders'} · ${esc(money(row.revenue))} revenue · ${esc(money(row.profit))} profit">
              <span class="rp-col__bars">
                <span class="rp-bar rp-bar--revenue" style="height:${Math.max(2, Math.round(((Number(row.revenue) || 0) / peak) * 100))}%"></span>
                <span class="rp-bar rp-bar--profit" style="height:${Math.max(2, Math.round(((Number(row.profit) || 0) / peak) * 100))}%"></span>
              </span>
              <span class="rp-col__label">${esc(dayLabel(row.day))}</span>
            </div>`
          )
          .join('')}
      </div>
    </div>
    <p class="rp-legend">
      <span><i class="rp-key rp-key--revenue"></i>Revenue${buckets[0]?.span > 1 ? ` · ${buckets[0].span}-day totals` : ' · per day'}</span>
      <span><i class="rp-key rp-key--profit"></i>Gross profit</span>
      <span class="admin-muted">Peak ${esc(money(peak))}</span>
    </p>`;
  }

  function renderReportProducts() {
    if (!els.reportProducts) return;
    const rows = state.report.products || [];
    if (!rows.length) {
      els.reportProducts.innerHTML = emptyState('Nothing sold in this window', 'Widen the range to see per-product margin.');
      if (els.reportProductsMore) {
        els.reportProductsMore.hidden = true;
        els.reportProductsMore.innerHTML = '';
      }
      return;
    }
    const sorted = [...rows].sort((left, right) => (Number(right.revenue) || 0) - (Number(left.revenue) || 0));
    const shown = sorted.slice(0, state.reportRows);
    els.reportProducts.innerHTML = table(
      ['Product', 'Units', 'Revenue', 'Profit', 'Margin', 'Price now', 'Cost now', 'Profit now', 'Stock'],
      shown.map((row) => `<tr>
        <td><strong>${esc(row.name)}</strong><span class="admin-sub">${esc(row.slug)}</span></td>
        <td class="admin-num">${Number(row.units) || 0}</td>
        <td class="admin-num">${money(row.revenue)}</td>
        <td class="admin-num">${row.profit === null || row.profit === undefined ? '<span class="admin-muted">untracked</span>' : money(row.profit)}</td>
        <td class="admin-num">${row.margin === null || row.margin === undefined ? '—' : `${Number(row.margin).toFixed(1)}%`}</td>
        <td class="admin-num">${row.currentPrice === null || row.currentPrice === undefined ? '—' : money(row.currentPrice)}</td>
        <td class="admin-num">${row.currentBaseCost === null || row.currentBaseCost === undefined ? '—' : money(row.currentBaseCost)}</td>
        <td class="admin-num">${row.currentProfit === null || row.currentProfit === undefined ? '—' : money(row.currentProfit)}</td>
        <td class="admin-num${Number(row.stock) < 1 ? ' admin-stock--out' : Number(row.stock) <= 8 ? ' admin-stock--low' : ''}">${
          row.stock === null || row.stock === undefined ? '—' : Number(row.stock)
        }</td>
      </tr>`
      )
    );
    const remaining = sorted.length - shown.length;
    if (els.reportProductsMore) {
      els.reportProductsMore.hidden = remaining <= 0;
      els.reportProductsMore.innerHTML = remaining
        ? `<span class="admin-muted">Showing ${shown.length} of ${sorted.length} products</span>
           <button class="admin-btn admin-btn--outline" type="button" data-report-loadmore>Show ${Math.min(40, remaining)} more</button>`
        : '';
    }
  }

  function renderPaymentMix() {
    if (!els.reportPaymentMix) return;
    const mix = state.report.paymentMix || [];
    if (!mix.length) {
      els.reportPaymentMix.innerHTML = '<p class="admin-muted admin-pad">No payments recorded in this window.</p>';
      return;
    }
    const total = mix.reduce((sum, entry) => sum + (Number(entry.total) || 0), 0) || 1;
    els.reportPaymentMix.innerHTML = `${mix
      .map((entry) => {
        const share = Math.round(((Number(entry.total) || 0) / total) * 100);
        return `<div class="rp-mix__row">
          <span class="rp-mix__label">${esc(entry.method || 'Unspecified')}</span>
          <span class="rp-mix__track"><span class="rp-mix__fill" style="width:${share}%"></span></span>
          <span class="rp-mix__value">${money(entry.total)} · ${share}%</span>
        </div>`;
      })
      .join('')}
      <p class="admin-form-hint">Share of revenue in ${esc(state.report.rangeLabel)}.</p>`;
  }

  els.reportRange?.addEventListener('change', () => {
    state.reportRange = els.reportRange.value || '30';
    loadReports().catch((error) => toast(error.message, true));
  });

  els.reportProductsMore?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-report-loadmore]')) return;
    state.reportRows += 40;
    renderReportProducts();
  });

  function renderExpenses() {
    if (!els.expensesTable) return;
    const list = state.expenses?.expenses || [];
    const totals = state.expenses?.totals || { monthly: 0, oneTime: 0, total: 0 };
    if (els.expenseNote) {
      els.expenseNote.textContent = `Recorded by hand — packaging, courier contracts, advertising. Monthly entries projected over 12 months: ${money(
        totals.monthly
      )} · one-time: ${money(totals.oneTime)} · total ${money(totals.total)}. The report above only charges the months inside the selected range.`;
    }
    const canWrite = isAdmin();
    els.expenseForm?.querySelectorAll('input, select, button').forEach((field) => {
      field.disabled = !canWrite;
    });
    if (els.expenseForm) els.expenseForm.hidden = !canWrite;
    if (canWrite && els.expenseForm && !els.expenseForm.date.value) {
      els.expenseForm.date.value = new Date().toISOString().slice(0, 10);
    }
    if (!list.length) {
      els.expensesTable.innerHTML = emptyState(
        'No expenses recorded',
        canWrite ? 'Add packaging, courier or advertising costs to see net profit, not just product margin.' : 'Ask an administrator to record operating expenses.'
      );
      return;
    }
    els.expensesTable.innerHTML = table(
      ['Expense', 'Amount', 'Repeats', 'Date', 'Note', ''],
      list
        .slice()
        .reverse()
        .map(
          (entry) => `<tr>
            <td><strong>${esc(entry.label)}</strong></td>
            <td class="admin-num">${money(entry.amount)}</td>
            <td>${esc(entry.period || 'monthly')}</td>
            <td class="admin-nowrap">${esc(dayLabel(entry.date))}</td>
            <td>${entry.note ? esc(entry.note) : '<span class="admin-muted">—</span>'}</td>
            <td class="admin-cell-action">${
              canWrite
                ? `<button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-expense-delete="${esc(entry.id)}" data-expense-label="${esc(entry.label)}">Delete</button>`
                : '<span class="admin-muted">Admin only</span>'
            }</td>
          </tr>`
        )
    );
  }

  els.expenseForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = els.expenseForm;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = $('[data-expense-save]', form);
    if (els.expenseError) els.expenseError.textContent = '';
    const payload = {
      label: String(data.get('label') || '').trim(),
      amount: Number(data.get('amount')),
      period: String(data.get('period') || 'monthly'),
      date: String(data.get('date') || ''),
      note: String(data.get('note') || '').trim()
    };
    if (!(payload.amount > 0)) {
      if (els.expenseError) els.expenseError.textContent = 'Enter an amount greater than zero.';
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const result = await request('/api/admin/expenses', { method: 'POST', json: payload });
      state.expenses = { expenses: result.expenses, totals: result.totals };
      form.reset();
      form.date.value = new Date().toISOString().slice(0, 10);
      renderExpenses();
      toast(`${payload.label} recorded.`);
      if (state.route === 'reports') await loadReports().catch(() => {});
    } catch (error) {
      if (els.expenseError) els.expenseError.textContent = error.message;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Add expense';
      }
    }
  });

  els.expensesTable?.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-expense-delete]');
    if (!remove) return;
    event.preventDefault();
    const label = remove.dataset.expenseLabel || 'this expense';
    if (!window.confirm(`Delete “${label}”? Net profit for future reports changes immediately.`)) return;
    remove.disabled = true;
    try {
      const result = await request(`/api/admin/expenses/${encodeURIComponent(remove.dataset.expenseDelete)}`, { method: 'DELETE' });
      state.expenses = { expenses: result.expenses, totals: result.totals };
      toast(`${label} deleted.`);
      renderExpenses();
      await loadReports().catch(() => {});
    } catch (error) {
      toast(error.message, true);
      remove.disabled = false;
    }
  });

  // ---------------------------------------------------------------- delivery log

  async function loadDelivery() {
    const data = await request('/api/admin/delivery');
    state.delivery = data;
    renderDelivery();
    updateBadges();
  }

  function renderDelivery() {
    if (!els.deliveryTable || !state.delivery) return;
    const providers = state.delivery.providers || {};
    if (els.deliveryNote) {
      const emailMode = providers.email === 'smtp' ? 'SMTP live' : 'email outbox only';
      const smsMode = providers.sms && providers.sms !== 'outbox' ? `SMS via ${providers.sms}` : 'SMS outbox only';
      els.deliveryNote.innerHTML = providers.live
        ? `<strong>Provider credentials detected.</strong> ${esc(emailMode)} · ${esc(smsMode)}. Entries below are the delivery log for the last 60 codes.`
        : `<strong>No SMTP or SMS credentials configured.</strong> ${esc(emailMode)} · ${esc(smsMode)}. Codes are recorded here only — set the credentials listed in the README to send them to customers. Each entry can be read below and relayed by hand.`;
    }
    const term = (els.deliverySearch?.value || '').trim().toLowerCase();
    const rows = (state.delivery.outbox || []).filter((entry) => {
      if (state.deliveryFilter !== 'all' && entry.status !== state.deliveryFilter) return false;
      if (!term) return true;
      return `${entry.to} ${entry.subject} ${entry.channel}`.toLowerCase().includes(term);
    });
    if (els.deliveryCount) {
      els.deliveryCount.textContent = `${rows.length} of ${(state.delivery.outbox || []).length} entries`;
    }
    if (!rows.length) {
      els.deliveryTable.innerHTML = emptyState(
        (state.delivery.outbox || []).length ? 'No entries match' : 'Nothing sent yet',
        (state.delivery.outbox || []).length
          ? 'Try another status or search term.'
          : 'Verification codes appear here as soon as a customer requests one.'
      );
      return;
    }
    els.deliveryTable.innerHTML = table(
      ['Channel', 'Recipient', 'Subject / template', 'Code', 'Status', 'Error', 'Created'],
      rows.map(
        (entry) => `<tr>
          <td><strong>${esc(entry.channel === 'sms' ? 'SMS' : 'Email')}</strong><span class="admin-sub">#${esc(entry.seq)}</span></td>
          <td>${esc(entry.to)}</td>
          <td>${entry.subject ? esc(entry.subject) : '<span class="admin-muted">—</span>'}</td>
          <td class="dl-code">
            <button class="admin-btn admin-btn--tiny admin-btn--outline" type="button" data-delivery-body="${esc(entry.seq)}" aria-expanded="false">Show code</button>
            <span class="dl-body" data-delivery-text="${esc(entry.seq)}" hidden>${esc(entry.body || 'No body stored')}</span>
          </td>
          <td>${statusBadge(entry.status === 'outbox' ? 'Outbox' : entry.status === 'queued' ? 'Queued' : entry.status === 'sent' ? 'Sent' : 'Failed')}</td>
          <td>${entry.error ? esc(entry.error) : '<span class="admin-muted">—</span>'}</td>
          <td class="admin-nowrap">${esc(dateTime(entry.createdAt))}</td>
        </tr>`
      )
    );
  }

  els.deliveryStatus?.addEventListener('change', () => {
    state.deliveryFilter = els.deliveryStatus.value || 'all';
    renderDelivery();
  });

  els.deliverySearch?.addEventListener('input', renderDelivery);

  els.deliveryTable?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-delivery-body]');
    if (!toggle) return;
    const text = els.deliveryTable.querySelector(`[data-delivery-text="${CSS.escape(toggle.dataset.deliveryBody)}"]`);
    if (!text) return;
    text.hidden = !text.hidden;
    toggle.setAttribute('aria-expanded', text.hidden ? 'false' : 'true');
    toggle.textContent = text.hidden ? 'Show code' : 'Hide code';
  });

  function startDeliveryPoll() {
    stopDeliveryPoll();
    state.deliveryTimer = setInterval(() => {
      if (state.route !== 'delivery' || !state.deliveryAuto) {
        stopDeliveryPoll();
        return;
      }
      loadDelivery().catch(() => stopDeliveryPoll());
    }, 10_000);
  }

  function stopDeliveryPoll() {
    if (!state.deliveryTimer) return;
    clearInterval(state.deliveryTimer);
    state.deliveryTimer = null;
  }

  els.deliveryAuto?.addEventListener('change', () => {
    state.deliveryAuto = els.deliveryAuto.checked === true;
    if (state.deliveryAuto && state.route === 'delivery') {
      startDeliveryPoll();
      toast('Delivery log refreshes every 10 seconds.');
    } else {
      stopDeliveryPoll();
    }
  });

  // ---------------------------------------------------------------- verification desk

  // Blob URLs for private identity files. Every one is revoked as soon as the
  // panel changes, so a document is never left addressable in this tab.
  const privateObjectUrls = new Set();

  function releaseDocumentUrls() {
    for (const url of privateObjectUrls) URL.revokeObjectURL(url);
    privateObjectUrls.clear();
  }

  async function fetchPrivateBlob(path) {
    let response;
    try {
      response = await fetch(path, { headers: state.token ? { 'x-velune-admin': state.token } : {} });
    } catch {
      throw new Error('The server could not be reached. Check that it is running.');
    }
    if (response.status === 401) {
      signOut('Your session expired. Sign in again.');
      throw new Error('Session expired.');
    }
    if (!response.ok) {
      let message = 'This file could not be read.';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        /* the file stream failed before any JSON was written */
      }
      throw new Error(message);
    }
    return response.blob();
  }

  const PRODUCT_PREVIEW_THEME_KEY = 'velune.admin.productPreviewTheme';
  const readProductPreviewTheme = () => {
    try {
      return localStorage.getItem(PRODUCT_PREVIEW_THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };
  const saveProductPreviewTheme = (theme) => {
    try {
      localStorage.setItem(PRODUCT_PREVIEW_THEME_KEY, theme);
    } catch {
      /* storage may be unavailable in private windows; the toggle still works in-session */
    }
  };

  const DOC_PREVIEW_THEME_KEY = 'velune.admin.docPreviewTheme';
  const readDocPreviewTheme = () => {
    try {
      return localStorage.getItem(DOC_PREVIEW_THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };
  const saveDocPreviewTheme = (theme) => {
    try {
      localStorage.setItem(DOC_PREVIEW_THEME_KEY, theme);
    } catch {
      /* storage may be unavailable in private windows; the toggle still works here */
    }
  };

  async function openPrivateFile(button, path) {
    if (!isAdmin()) {
      toast('Only an administrator can open identity files.', true);
      return;
    }
    const holder = button.closest('[data-doc-holder]')?.querySelector('[data-doc-preview]');
    if (holder && !holder.hidden) {
      holder.hidden = true;
      holder.innerHTML = '';
      holder.classList.remove('is-dark');
      button.textContent = 'View file';
      return;
    }
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
      const blob = await fetchPrivateBlob(path);
      const url = URL.createObjectURL(blob);
      privateObjectUrls.add(url);
      if (!holder) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      if (String(blob.type || '').startsWith('image/')) {
        const theme = readDocPreviewTheme();
        holder.classList.toggle('is-dark', theme === 'dark');
        holder.innerHTML = `
          <div class="vf-doc__toolbar">
            <span class="vf-doc__theme-label">Preview background</span>
            <span class="vf-doc__theme" role="group" aria-label="Preview background">
              <button type="button" data-doc-theme="light" aria-pressed="${theme === 'light'}" class="${theme === 'light' ? 'is-active' : ''}">Light</button>
              <button type="button" data-doc-theme="dark" aria-pressed="${theme === 'dark'}" class="${theme === 'dark' ? 'is-active' : ''}">Dark</button>
            </span>
          </div>
          <div class="vf-doc__stage"><img src="${esc(url)}" alt="Identity document"></div>`;
        for (const option of holder.querySelectorAll('[data-doc-theme]')) {
          option.addEventListener('click', () => {
            const next = option.dataset.docTheme === 'dark' ? 'dark' : 'light';
            holder.classList.toggle('is-dark', next === 'dark');
            saveDocPreviewTheme(next);
            for (const peer of holder.querySelectorAll('[data-doc-theme]')) {
              const active = peer.dataset.docTheme === next;
              peer.classList.toggle('is-active', active);
              peer.setAttribute('aria-pressed', String(active));
            }
          });
        }
      } else {
        holder.classList.remove('is-dark');
        holder.innerHTML = `<p class="admin-muted">${esc(blob.type || 'File')} · ${Math.round(blob.size / 1024)} KB. Documents are not embedded here —
          <a class="admin-link" href="${esc(url)}" target="_blank" rel="noopener">open in a new tab</a>.</p>`;
      }
      holder.hidden = false;
      button.textContent = 'Hide file';
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      if (button.textContent === 'Loading…') button.textContent = 'View file';
    }
  }

  async function loadVerification() {
    const data = await request('/api/admin/verification');
    let customers = [];
    try {
      const extra = await request('/api/admin/customers');
      customers = extra.customers || [];
    } catch {
      /* the queue still renders; the document list needs the customer records */
    }
    state.verification = data;
    if (customers.length) state.customers = customers;
    renderVerification();
    updateBadges();
  }

  function verificationRows() {
    const data = state.verification;
    if (!data) return [];
    const all = data.customers || [];
    const base =
      state.verifyFilter === 'queue'
        ? data.queue || []
        : all.filter((row) => (state.verifyFilter === 'unverified' ? (row.status || 'unverified') === 'unverified' : row.status === state.verifyFilter));
    const term = (els.verifySearch?.value || '').trim().toLowerCase();
    if (!term) return base;
    return base.filter((row) => `${row.name} ${row.email} ${row.phone}`.toLowerCase().includes(term));
  }

  const contactMark = (ok, label) =>
    `<span class="vf-check vf-check--${ok ? 'ok' : 'no'}" title="${esc(ok ? `${label} verified` : `${label} not verified}`)}">${ok ? '✓' : '·'} ${esc(label)}</span>`;

  function renderVerification() {
    if (!els.verifyTable || !state.verification) return;
    const counts = state.verification.counts || {};
    const rows = verificationRows();
    if (els.verifyCount) {
      els.verifyCount.textContent =
        state.verifyFilter === 'queue'
          ? `${rows.length} awaiting a decision`
          : `${rows.length} of ${counts.total || 0} accounts`;
    }
    if (els.verifyPolicyNote) {
      const policy = state.verification.policy || {};
      const providers = state.verification.providers || {};
      els.verifyPolicyNote.textContent = `${policy.mode === 'otp' ? 'Codes only' : 'Codes + documents'} · kept ${Number(policy.retentionDays) || 0} days · ${
        providers.live ? 'SMTP/SMS live' : 'codes land in Delivery'
      }`;
    }
    if (!rows.length) {
      els.verifyTable.innerHTML = emptyState(
        state.verifyFilter === 'queue' ? 'Nothing to review' : 'No accounts in this tab',
        state.verifyFilter === 'queue'
          ? 'Every customer with a pending document or unverified contact has been handled.'
          : 'Try another tab or search term.'
      );
      return;
    }
    els.verifyTable.innerHTML = table(
      ['Customer', 'Status', 'Contact checks', 'Documents', 'Last review', ''],
      rows.map(
        (row) => `<tr>
          <td>
            <strong>${esc(row.name || 'Unnamed')}</strong>
            <span class="admin-sub">${esc(row.email)}${row.phone ? ` · ${esc(row.phone)}` : ''}</span>
          </td>
          <td>${statusBadge(row.status === 'unverified' ? 'Unverified' : row.status === 'pending' ? 'Pending' : row.status === 'approved' ? 'Approved' : 'Rejected')}</td>
          <td class="vf-checks">${contactMark(row.emailVerified, 'Email')}${contactMark(row.phoneVerified, 'Mobile')}</td>
          <td class="admin-num">${Number(row.documentCount) || 0} uploaded${Number(row.documentsPending) ? `<span class="admin-sub">${Number(row.documentsPending)} pending</span>` : ''}</td>
          <td class="admin-nowrap">${esc(shortDate(row.reviewedAt))}<span class="admin-sub">${esc(row.reviewedBy || 'not reviewed')}</span></td>
          <td class="admin-cell-action"><button class="admin-btn admin-btn--tiny${row.documentsPending ? ' admin-btn--primary' : ''}" type="button" data-verify-open="${esc(row.id)}">Review</button></td>
        </tr>`
      )
    );
    if (state.verifyDetailId) renderVerifyDetail(state.verifyDetailId);
  }

  function verifyDocumentsFor(customerId) {
    const customer = (state.customers || []).find((entry) => entry.id === customerId);
    const docs = customer?.verification?.documents;
    return Array.isArray(docs) ? docs : null;
  }

  function renderVerifyDetail(customerId) {
    if (!els.verifyDetail) return;
    releaseDocumentUrls();
    const row = (state.verification?.customers || []).find((entry) => entry.id === customerId);
    if (!row) {
      state.verifyDetailId = '';
      els.verifyDetail.innerHTML = emptyState('No customer selected', 'Open a customer from the queue to read their checks and documents.');
      return;
    }
    state.verifyDetailId = customerId;
    const documents = verifyDocumentsFor(customerId);
    const admin = isAdmin();
    const documentsMarkup = documents === null
      ? '<p class="admin-muted">The per-document list is only available alongside the customer records. Use Refresh to load them.</p>'
      : documents.length
        ? documents
            .map(
              (doc) => `<article class="vf-doc" data-doc-holder="${esc(doc.id)}">
                <div class="vf-doc__head">
                  <strong>${esc(doc.docType || 'document')}</strong>
                  <span class="admin-sub">${esc(doc.kind || 'front')} · ${Math.round((Number(doc.bytes) || 0) / 1024)} KB · uploaded ${esc(shortDate(doc.createdAt))}</span>
                </div>
                <span class="admin-status admin-status--${doc.status === 'accepted' ? 'confirmed' : doc.status === 'rejected' ? 'cancelled' : 'open'}">${esc(DOC_STATUS[doc.status] || doc.status)}</span>
                ${doc.note ? `<p class="vf-doc__note">${esc(doc.note)}</p>` : ''}
                ${doc.reviewedBy ? `<p class="admin-sub">Reviewed by ${esc(doc.reviewedBy)} · ${esc(dateTime(doc.reviewedAt))}</p>` : ''}
                <div class="vf-doc__actions">
                  <button class="admin-btn admin-btn--tiny admin-btn--outline" type="button" data-doc-view="${esc(doc.id)}"${admin ? '' : ' disabled title="Only an administrator can open identity files"'}>View file</button>
                  <button class="admin-btn admin-btn--tiny" type="button" data-doc-decision="accepted" data-doc-id="${esc(doc.id)}"${admin ? '' : ' disabled'}>Accept</button>
                  <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-doc-decision="rejected" data-doc-id="${esc(doc.id)}"${admin ? '' : ' disabled'}>Reject</button>
                </div>
                <div class="vf-doc__preview" data-doc-preview hidden></div>
              </article>`
            )
            .join('')
        : '<p class="admin-muted">No identity document has been uploaded. Documents are only required for wholesale and reseller access.</p>';

    els.verifyDetail.innerHTML = `<div class="vf-detail">
        <div class="vf-head">
          <span class="vf-avatar" data-verify-avatarbox>${esc(initialsOf(row.name).slice(0, 2))}</span>
          <div>
            <strong>${esc(row.name || 'Unnamed')}</strong>
            <span class="admin-sub">${esc(row.email)}${row.phone ? ` · ${esc(row.phone)}` : ''}</span>
            <span class="admin-sub">Joined ${esc(shortDate(row.createdAt))} · last sign-in ${row.lastLoginAt ? esc(dateTime(row.lastLoginAt)) : 'never'}</span>
          </div>
        </div>
        <div class="vf-checks">
          ${contactMark(row.emailVerified, 'Email')}
          ${contactMark(row.phoneVerified, 'Mobile')}
          ${statusBadge(row.status === 'unverified' ? 'Unverified' : row.status === 'pending' ? 'Pending' : row.status === 'approved' ? 'Approved' : 'Rejected')}
        </div>
        ${admin ? '' : '<p class="admin-note">Your employee account may read this queue, but only an administrator can view identity files or record an identity decision.</p>'}
        <h3 class="vf-title">Identity documents</h3>
        ${documentsMarkup}
        <h3 class="vf-title">Decision</h3>
        <label class="admin-field">
          <span>Note to the customer <em>optional</em></span>
          <textarea class="admin-input admin-textarea" name="note" rows="2" maxlength="400" data-verify-note placeholder="We could not read the document photo — please send a clearer one.">${esc(row.note || '')}</textarea>
          <small>A rejection note is included in the email we send. Do not paste document contents or ID numbers here.</small>
        </label>
        <div class="vf-actions">
          <button class="admin-btn admin-btn--primary admin-btn--tiny" type="button" data-verify-decision="approved"${admin ? '' : ' disabled'}>Approve</button>
          <button class="admin-btn admin-btn--danger admin-btn--tiny" type="button" data-verify-decision="rejected"${admin ? '' : ' disabled'}>Reject</button>
          <button class="admin-btn admin-btn--outline admin-btn--tiny" type="button" data-verify-decision="pending"${admin ? '' : ' disabled'}>Back to pending</button>
          <span class="admin-actions-spacer"></span>
          <button class="admin-btn admin-btn--tiny" type="button" data-verify-close>Close</button>
        </div>
        <p class="vf-actions vf-actions--purge">
          <button class="admin-btn admin-btn--outline admin-btn--danger admin-btn--tiny" type="button" data-verify-purge="${esc(row.id)}"${admin ? '' : ' disabled'}>Purge stored files</button>
          <span class="admin-muted">Deletes every uploaded document and the profile picture from disk. Identity decisions are kept.</span>
        </p>
        <p class="admin-form-error" role="alert" data-verify-error></p>
      </div>`;

    if (admin) loadVerifyAvatar(row);
  }

  async function loadVerifyAvatar(row) {
    const box = $('[data-verify-avatarbox]', els.verifyDetail);
    if (!box) return;
    try {
      const blob = await fetchPrivateBlob(`/api/admin/verification/${encodeURIComponent(row.id)}/avatar`);
      if (state.verifyDetailId !== row.id || !box.isConnected) return;
      const url = URL.createObjectURL(blob);
      privateObjectUrls.add(url);
      box.innerHTML = `<img src="${esc(url)}" alt="Profile picture of ${esc(row.name || 'customer')}">`;
    } catch {
      /* no profile picture on this account — keep the initials */
    }
  }

  $$('[data-verify-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.verifyFilter = button.dataset.verifyFilter;
      $$('[data-verify-filter]').forEach((entry) => entry.classList.toggle('is-active', entry === button));
      renderVerification();
    });
  });

  els.verifySearch?.addEventListener('input', renderVerification);

  els.verifyTable?.addEventListener('click', (event) => {
    const open = event.target.closest('[data-verify-open]');
    if (!open) return;
    event.preventDefault();
    const detailId = open.dataset.verifyOpen;
    if (detailId !== state.verifyDetailId) releaseDocumentUrls();
    renderVerifyDetail(detailId);
    els.verifyDetail?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  els.verifyDetail?.addEventListener('click', async (event) => {
    const errorNode = $('[data-verify-error]', els.verifyDetail);
    const noteField = $('[data-verify-note]', els.verifyDetail);
    const note = () => String(noteField?.value || '').trim();

    if (event.target.closest('[data-verify-close]')) {
      state.verifyDetailId = '';
      releaseDocumentUrls();
      renderVerifyDetail('');
      return;
    }
    const view = event.target.closest('[data-doc-view]');
    if (view) {
      event.preventDefault();
      const documentId = view.dataset.docView;
      const row = (state.verification?.customers || []).find((entry) => entry.id === state.verifyDetailId);
      if (!row) return;
      await openPrivateFile(view, `/api/admin/verification/${encodeURIComponent(row.id)}/documents/${encodeURIComponent(documentId)}`, 'document');
      return;
    }
    const decision = event.target.closest('[data-verify-decision]');
    if (decision) {
      const status = decision.dataset.verifyDecision;
      if (status === 'rejected' && !note()) {
        if (errorNode) errorNode.textContent = 'Add the note the customer should see before rejecting.';
        return;
      }
      const current = (state.verification?.customers || []).find((entry) => entry.id === state.verifyDetailId);
      const name = current?.name || current?.email || 'this customer';
      const outcome =
        status === 'approved'
          ? 'Wholesale and reseller access unlocks and every pending document is accepted.'
          : status === 'rejected'
            ? 'The customer sees your note and can upload again.'
            : 'The account returns to the review queue without changing the documents.';
      if (!window.confirm(`Record this decision for ${name}? ${outcome}`)) return;
      setBusy(decision, 'Saving…');
      try {
        const result = await request(`/api/admin/verification/${encodeURIComponent(state.verifyDetailId)}`, {
          method: 'PATCH',
          json: { status, note: note() }
        });
        if (result.customer) {
          state.customers = (state.customers || []).map((entry) => (entry.id === result.customer.id ? result.customer : entry));
        }
        toast(result.message || 'Decision recorded.');
        await loadVerification();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        else toast(error.message, true);
        setBusy(decision, null);
      }
      return;
    }
    const docDecision = event.target.closest('[data-doc-decision]');
    if (docDecision) {
      setBusy(docDecision, 'Saving…');
      try {
        const result = await request(`/api/admin/documents/${encodeURIComponent(docDecision.dataset.docId)}`, {
          method: 'PATCH',
          json: { status: docDecision.dataset.docDecision, note: note() }
        });
        if (result.verification?.documents && state.verifyDetailId) {
          state.customers = (state.customers || []).map((entry) =>
            entry.id === state.verifyDetailId
              ? { ...entry, verification: { ...entry.verification, documents: result.verification.documents, status: result.verification.status } }
              : entry
          );
        }
        toast(result.message || 'Document review saved.');
        await loadVerification();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        else toast(error.message, true);
        setBusy(docDecision, null);
      }
      return;
    }
    const purge = event.target.closest('[data-verify-purge]');
    if (purge) {
      const id = purge.dataset.verifyPurge;
      if (
        !window.confirm(
          'Purge this customer’s stored files? Every uploaded identity document and the profile picture are deleted permanently from the server disk. This cannot be undone and the customer would have to upload again.'
        )
      ) {
        return;
      }
      setBusy(purge, 'Deleting…');
      try {
        const result = await request(`/api/admin/verification/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast(result.message || 'Stored files deleted.');
        releaseDocumentUrls();
        await loadVerification();
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
        else toast(error.message, true);
        setBusy(purge, null);
      }
    }
  });

  function setBusy(button, label) {
    if (!button) return;
    if (label === null) {
      button.disabled = false;
      if (button.dataset.busyLabel) button.textContent = button.dataset.busyLabel;
      return;
    }
    button.dataset.busyLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  }

  // ---------------------------------------------------------------- settings

  async function loadSettings() {
    const data = await request('/api/admin/settings');
    state.settings = data.settings;
    state.categories = data.categories || [];
    renderSettings();
    renderCurrencyForm();
    renderKycForm();
    renderPaymentsPanel();
    renderCategories();
    fillCategoryOptions();
  }

  function renderSettings() {
    const form = els.settingsForm;
    if (!form || !state.settings) return;
    for (const key of ['supportEmail', 'whatsapp', 'telegram', 'hours', 'responseTime', 'announcement']) {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = state.settings[key] || '';
    }
    if (els.settingsError) els.settingsError.textContent = '';
    const hint = $('[data-settings-hint]', form);
    if (hint) {
      hint.textContent = state.settings.whatsapp || state.settings.telegram
        ? 'WhatsApp and Telegram links are live on the storefront.'
        : 'WhatsApp and Telegram stay hidden until you add a number or username.';
    }
  }

  function renderCategories() {
    if (!els.categoriesList) return;
    if (els.categoriesCount) {
      els.categoriesCount.textContent = `${state.categories.length} total`;
    }
    if (!state.categories.length) {
      els.categoriesList.innerHTML = '<p class="admin-muted">No categories yet.</p>';
      return;
    }
    els.categoriesList.innerHTML = state.categories
      .map(
        (category) => `<div class="admin-category-row">
          <div>
            <strong>${esc(category.name)}</strong>
            <span class="admin-sub">/${esc(category.slug)}</span>
          </div>
          <div class="admin-category-row__actions">
            <button class="admin-btn admin-btn--tiny" type="button" data-category-rename="${esc(category.slug)}">Rename</button>
            <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-category-delete="${esc(category.slug)}">Delete</button>
          </div>
        </div>`
      )
      .join('');
  }

  els.settingsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!els.settingsForm.reportValidity()) return;
    const form = els.settingsForm;
    const data = new FormData(form);
    const button = $('[data-settings-save]', form);
    if (els.settingsError) els.settingsError.textContent = '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const result = await request('/api/admin/settings', {
        method: 'PATCH',
        json: {
          supportEmail: String(data.get('supportEmail') || '').trim(),
          whatsapp: String(data.get('whatsapp') || '').trim(),
          telegram: String(data.get('telegram') || '').trim(),
          hours: String(data.get('hours') || '').trim(),
          responseTime: String(data.get('responseTime') || '').trim(),
          announcement: String(data.get('announcement') || '').trim()
        }
      });
      state.settings = result.settings;
      renderSettings();
      toast('Store settings saved. Storefront updates on the next page load.');
    } catch (error) {
      if (els.settingsError) els.settingsError.textContent = error.message;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Save settings';
      }
    }
  });

  // ── currency + verification policy ─────────────────────────
  function renderCurrencyForm() {
    const form = els.currencyForm;
    if (!form || !state.settings) return;
    const currency = state.settings.currency || {};
    form.display.value = currency.display === 'INR' ? 'INR' : 'USD';
    form.inrPerUsd.value = Number.isFinite(Number(currency.inrPerUsd)) ? Number(currency.inrPerUsd) : 83.2;
    form.symbolUsd.value = currency.symbolUsd || '$';
    form.symbolInr.value = currency.symbolInr || '₹';
    if (els.currencyError) els.currencyError.textContent = '';
  }

  function renderKycForm() {
    const form = els.kycForm;
    if (!form || !state.settings) return;
    const kyc = state.settings.kyc || {};
    form.mode.value = kyc.mode === 'otp' ? 'otp' : 'otp+documents';
    form.retentionDays.value = Number.isFinite(Number(kyc.retentionDays)) ? Number(kyc.retentionDays) : 180;
    form.acceptedDocTypes.value = (kyc.acceptedDocTypes || []).join(', ');
    form.protectedFeatures.value = (kyc.protectedFeatures || []).join(', ');
    form.requireDocumentsForReseller.checked = kyc.requireDocumentsForReseller !== false;
    if (els.kycError) els.kycError.textContent = '';
  }

  const listFromField = (value, max) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, max);

  els.currencyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = els.currencyForm;
    if (!form.reportValidity()) return;
    const button = $('[data-currency-save]', form);
    if (els.currencyError) els.currencyError.textContent = '';
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const result = await request('/api/admin/settings', {
        method: 'PATCH',
        json: {
          currency: {
            display: form.display.value,
            inrPerUsd: Number(form.inrPerUsd.value),
            symbolUsd: form.symbolUsd.value.trim(),
            symbolInr: form.symbolInr.value.trim()
          }
        }
      });
      state.settings = result.settings;
      renderCurrencyForm();
      toast('Currency saved. Storefront prices convert on the next page load.');
    } catch (error) {
      if (els.currencyError) els.currencyError.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save currency';
    }
  });

  els.kycForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = els.kycForm;
    if (!form.reportValidity()) return;
    const button = $('[data-kyc-save]', form);
    if (els.kycError) els.kycError.textContent = '';
    const retention = Number(form.retentionDays.value);
    if (!Number.isFinite(retention) || retention < 7 || retention > 3650) {
      if (els.kycError) els.kycError.textContent = 'Retention must be between 7 and 3650 days.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const result = await request('/api/admin/settings', {
        method: 'PATCH',
        json: {
          kyc: {
            mode: form.mode.value,
            requireDocumentsForReseller: form.requireDocumentsForReseller.checked,
            acceptedDocTypes: listFromField(form.acceptedDocTypes.value, 12),
            protectedFeatures: listFromField(form.protectedFeatures.value, 10),
            retentionDays: Math.round(retention)
          }
        }
      });
      state.settings = result.settings;
      renderKycForm();
      toast('Verification policy saved.');
      if (state.route === 'verification') await loadVerification().catch(() => {});
    } catch (error) {
      if (els.kycError) els.kycError.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save verification policy';
    }
  });
  // ── end currency + verification policy ─────────────────────

  els.categoryForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = els.categoryForm;
    if (!form.reportValidity()) return;
    const input = form.querySelector('[name="name"]');
    const name = input?.value.trim() || '';
    if (els.categoryError) els.categoryError.textContent = '';
    try {
      const result = await request('/api/admin/categories', { method: 'POST', json: { name } });
      state.categories = result.categories;
      form.reset();
      renderCategories();
      fillCategoryOptions();
      if (state.products) renderProducts();
      toast(`Category “${name}” added.`);
    } catch (error) {
      if (els.categoryError) els.categoryError.textContent = error.message;
    }
  });

  async function renameCategory(slug) {
    const category = state.categories.find((entry) => entry.slug === slug);
    if (!category) return;
    const name = window.prompt('New category name', category.name);
    if (name === null || !name.trim() || name.trim() === category.name) return;
    try {
      const result = await request(`/api/admin/categories/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        json: { name: name.trim() }
      });
      state.categories = result.categories;
      renderCategories();
      fillCategoryOptions();
      if (state.products) renderProducts();
      toast('Category renamed.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function deleteCategory(slug) {
    const category = state.categories.find((entry) => entry.slug === slug);
    if (!category) return;
    if (!window.confirm(`Delete the “${category.name}” category? Products must be moved first.`)) return;
    try {
      const result = await request(`/api/admin/categories/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      state.categories = result.categories;
      renderCategories();
      fillCategoryOptions();
      if (state.products) renderProducts();
      toast('Category deleted.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- subscribers

  async function loadSubscribers() {
    const data = await request('/api/admin/subscribers');
    state.subscribers = data.subscribers;
    renderSubscribers();
  }

  function renderSubscribers() {
    if (!els.subscribersTable || !state.subscribers) return;
    const term = (els.subscriberSearch?.value || '').trim().toLowerCase();
    const filtered = state.subscribers.filter((subscriber) => !term || subscriber.email.toLowerCase().includes(term));
    if (els.subscribersCount) {
      els.subscribersCount.textContent = `${filtered.length} of ${state.subscribers.length} ${state.subscribers.length === 1 ? 'subscriber' : 'subscribers'}`;
    }
    if (!state.subscribers.length) {
      els.subscribersTable.innerHTML = emptyState('No subscribers yet', 'Newsletter signups from the storefront footer appear here.');
      return;
    }
    if (!filtered.length) {
      els.subscribersTable.innerHTML = emptyState('No matching subscribers', 'Try a different email search.');
      return;
    }
    els.subscribersTable.innerHTML = table(
      ['Email', 'Joined'],
      filtered.map(
        (subscriber) => `<tr>
          <td>${esc(subscriber.email)}</td>
          <td class="admin-nowrap">${esc(shortDate(subscriber.createdAt))}</td>
        </tr>`
      )
    );
  }

  els.subscriberSearch?.addEventListener('input', renderSubscribers);

  $('[data-copy-subscribers]')?.addEventListener('click', async () => {
    if (!state.subscribers?.length) {
      toast('No subscribers to copy.', true);
      return;
    }
    const text = state.subscribers.map((subscriber) => subscriber.email).join(', ');
    try {
      await navigator.clipboard.writeText(text);
      toast(`${state.subscribers.length} email${state.subscribers.length === 1 ? '' : 's'} copied.`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      toast(copied ? 'Emails copied.' : 'Copy failed — select the list manually.', !copied);
    }
  });

  // ---------------------------------------------------------------- global actions

  document.addEventListener('click', (event) => {
    const orderButton = event.target.closest('[data-order-view]');
    if (orderButton) {
      event.preventDefault();
      openOrderModal(orderButton.dataset.orderView);
      return;
    }
    const productButton = event.target.closest('[data-product-edit]');
    if (productButton) {
      event.preventDefault();
      const product = state.products?.find((entry) => entry.slug === productButton.dataset.productEdit);
      if (product) openProductModal(product);
      else toast('Product not found. Refresh and try again.', true);
      return;
    }
    const ticketButton = event.target.closest('[data-ticket-toggle]');
    if (ticketButton) {
      event.preventDefault();
      toggleTicket(ticketButton.dataset.ticketToggle, ticketButton.dataset.ticketNext, ticketButton);
      return;
    }
    const adminReplyForm = event.target.closest('[data-admin-reply]');
    if (adminReplyForm && event.target.closest('button[type="submit"]')) {
      event.preventDefault();
      adminReplyForm.dispatchEvent(new Event('_admin-reply-submit'));
      return;
    }
    const customerOrders = event.target.closest('[data-customer-orders]');
    if (customerOrders) {
      event.preventDefault();
      if (els.orderSearch) els.orderSearch.value = customerOrders.dataset.customerOrders || '';
      go('orders');
      return;
    }
    const customerDelete = event.target.closest('[data-customer-delete]');
    if (customerDelete) {
      event.preventDefault();
      deleteCustomer(customerDelete.dataset.customerDelete, customerDelete.dataset.customerEmail || 'this customer');
      return;
    }
    const categoryRename = event.target.closest('[data-category-rename]');
    if (categoryRename) {
      event.preventDefault();
      renameCategory(categoryRename.dataset.categoryRename);
      return;
    }
    const categoryDelete = event.target.closest('[data-category-delete]');
    if (categoryDelete) {
      event.preventDefault();
      deleteCategory(categoryDelete.dataset.categoryDelete);
      return;
    }
    const staffEdit = event.target.closest('[data-staff-edit]');
    if (staffEdit) {
      event.preventDefault();
      const entry = state.staff?.find((item) => item.id === staffEdit.dataset.staffEdit);
      if (entry) openStaffModal(entry);
      else toast('Account not found. Refresh and try again.', true);
      return;
    }
    const staffPassword = event.target.closest('[data-staff-password]');
    if (staffPassword) {
      event.preventDefault();
      const entry = state.staff?.find((item) => item.id === staffPassword.dataset.staffPassword);
      if (!entry) {
        toast('Account not found. Refresh and try again.', true);
        return;
      }
      const password = window.prompt(
        `Set a new password for ${entry.name}. At least 10 characters — the account is signed out on the next request.`
      );
      if (password === null) return;
      if (password.length < 10) {
        toast('Password must be at least 10 characters.', true);
        return;
      }
      patchStaff(entry.id, { password }, `Password reset for ${entry.name}.`);
      return;
    }
    const staffActive = event.target.closest('[data-staff-active]');
    if (staffActive) {
      event.preventDefault();
      const entry = state.staff?.find((item) => item.id === staffActive.dataset.staffActive);
      if (!entry) return;
      const next = staffActive.dataset.staffNext === 'true';
      if (!next && !window.confirm(`Disable ${entry.name}? They cannot sign in or use their existing session until you enable the account again.`)) return;
      if (staffActive) {
        staffActive.disabled = true;
        staffActive.textContent = 'Saving…';
      }
      patchStaff(entry.id, { active: next }, next ? `${entry.name} enabled.` : `${entry.name} disabled.`);
      return;
    }
    const staffDelete = event.target.closest('[data-staff-delete]');
    if (staffDelete) {
      event.preventDefault();
      const id = staffDelete.dataset.staffDelete;
      const name = staffDelete.dataset.staffName || 'this account';
      if (!window.confirm(`Delete ${name}? The sign-in details are removed permanently and cannot be restored.`)) return;
      staffDelete.disabled = true;
      (async () => {
        try {
          await request(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
          toast(`${name} deleted.`);
          await loadStaff();
        } catch (error) {
          toast(error.message, true);
          staffDelete.disabled = false;
        }
      })();
    }
  });

  // ---------------------------------------------------------------- live chat desk

  const chat = {
    conversations: [],
    payments: null,
    activeId: '',
    thread: null,
    order: null,
    customer: null,
    customerOnline: false,
    filter: 'open',
    term: '',
    stream: null,
    attempts: 0,
    pollTimer: null,
    onlineIds: new Set(),
    typingIds: new Set(),
    rendered: new Set(),
    pendingAttachment: null,
    typingTimer: null,
    typingSent: false,
    unreadAdmin: 0
  };

  const initialsOf = (name) => {
    const words = String(name || 'Guest').trim().split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((word) => word[0]).join('');
    return (letters || 'G').toUpperCase();
  };

  const timeAgo = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.round(seconds / 86400)}d`;
    return shortDate(iso);
  };

  function paymentCardMarkup(info) {
    if (!info) return '';
    const lines = Array.isArray(info.lines)
      ? info.lines.filter((line) => line && line.label && line.value)
      : [
          { label: 'UPI', value: info.upi },
          { label: 'Binance', value: info.binance },
          { label: 'Crypto', value: info.crypto }
        ].filter((line) => line.value);
    if (!lines.length) return '';
    return `<div class="lc-paycard">
      <strong>${esc(info.heading || info.label || 'Payment details')}</strong>
      ${info.note ? `<p>${esc(info.note)}</p>` : ''}
      <ul>${lines.map((line) => `<li><span>${esc(line.label)}</span><code>${esc(line.value)}</code></li>`).join('')}</ul>
    </div>`;
  }

  // Message deletion is a moderation power: the server allows it for
  // administrators and for employees holding the `moderate` permission
  // (server.js:536 requireMessageModeration), so the control is only rendered
  // for those accounts.
  function canModerateMessages() {
    return isAdmin() || state.user?.permissions?.moderate === true;
  }

  function chatBubble(message) {
    const side = message.from === 'customer' ? 'customer' : message.from === 'system' ? 'system' : 'team';
    const attachment = message.attachment
      ? `<a class="lc-file" href="${esc(message.attachment.path)}" target="_blank" rel="noopener">
           <img src="${esc(message.attachment.path)}" alt="${esc(message.attachment.kind === 'slip' ? 'Payment slip' : 'Image')}" loading="lazy">
           <span>${esc(message.attachment.kind === 'slip' ? 'Payment slip' : 'Image')} · ${esc(dateTime(message.at))}</span>
         </a>`
      : '';
    return `<div class="lc-msg lc-msg--${side}" data-message="${esc(message.id)}">
      <div class="lc-msg__bubble">
        <p>${esc(message.text)}</p>
        ${attachment}
        ${paymentCardMarkup(message.paymentInfo)}
        <span class="lc-msg__time">${esc(dateTime(message.at))}</span>
        ${canModerateMessages()
          ? `<button class="lc-msg__delete" type="button" data-lc-del="${esc(message.id)}" title="Delete this message" aria-label="Delete this message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
            </button>`
          : ''}
      </div>
    </div>`;
  }

  function renderChatList() {
    if (!els.lcList) return;
    const term = chat.term.toLowerCase();
    const rows = chat.conversations.filter((entry) => {
      if (chat.filter === 'open' && entry.status !== 'open') return false;
      if (chat.filter === 'resolved' && entry.status !== 'resolved') return false;
      if (chat.filter === 'unread' && !(Number(entry.unread?.admin) > 0)) return false;
      if (!term) return true;
      return `${entry.name} ${entry.email} ${entry.phone} ${entry.id} ${entry.orderNumber || ''}`.toLowerCase().includes(term);
    });
    if (!rows.length) {
      const scoped = !isAdmin() && (state.user?.chatScope || 'all') === 'assigned';
      els.lcList.innerHTML = emptyState(
        'No conversations here',
        chat.conversations.length
          ? 'Try another filter or search term.'
          : scoped
          ? 'Chats assigned to another agent stay hidden from this desk, so an empty list is expected. Unclaimed and your own conversations appear here as soon as they are opened.'
          : 'Customer chats from the storefront land here in real time.'
      );
      return;
    }
    els.lcList.innerHTML = rows
      .map((entry) => {
        const unread = Number(entry.unread?.admin || 0);
        const online = chat.onlineIds.has(entry.id);
        const preview = entry.lastMessage
          ? `${entry.lastMessage.from === 'customer' ? '' : 'You: '}${entry.lastMessage.text || (entry.lastMessage.hasAttachment ? 'Attachment' : '')}`
          : 'No messages yet';
        return `<button class="lc-row${entry.id === chat.activeId ? ' is-active' : ''}" type="button" data-lc-open="${esc(entry.id)}">
          <span class="lc-row__avatar">${esc(initialsOf(entry.name))}${online ? '<i class="lc-dot" aria-hidden="true"></i>' : ''}</span>
          <span class="lc-row__main">
            <span class="lc-row__top"><strong>${esc(entry.name || entry.email || 'Guest')}</strong><em>${esc(timeAgo(entry.lastMessageAt))}</em></span>
            <span class="lc-row__preview">${esc(preview)}</span>
            <span class="lc-row__tags">
              <span>${esc(entry.id)}</span>
              ${entry.orderNumber ? `<span>Order ${esc(entry.orderNumber)}</span>` : ''}
              ${!entry.visitorId && !entry.customerId ? '<span class="lc-tag" title="No browser is attached to this thread, so the customer cannot see replies until they reopen the chat from /contact with their chat ID and phone.">Customer not connected</span>' : ''}
              ${entry.status === 'resolved' ? '<span class="lc-tag lc-tag--resolved">Resolved</span>' : ''}
            </span>
          </span>
          ${unread ? `<span class="lc-row__badge">${unread}</span>` : ''}
        </button>`;
      })
      .join('');
  }

  function orderContextMarkup() {
    const order = chat.order;
    if (!order) return '';
    const proofs = Array.isArray(order.paymentProof) ? order.paymentProof : [];
    const proofMarkup = proofs.length
      ? proofs
          .slice(-3)
          .reverse()
          .map(
            (proof) => `<figure class="lc-proof${proof.status ? ` lc-proof--${proof.status}` : ''}">
              <a href="${esc(proof.path)}" target="_blank" rel="noopener"><img src="${esc(proof.path)}" alt="Payment slip" loading="lazy"></a>
              <figcaption>${esc(proof.method || order.paymentMethod || '')} · ${esc(proof.status || 'pending')}</figcaption>
            </figure>`
          )
          .join('')
      : '<p class="lc-proof__none">No slip uploaded yet.</p>';
    return `<div class="lc-order">
      <div class="lc-order__head">
        <strong>${esc(order.number)}</strong>
        <span>${money(order.total)} · ${esc(order.paymentMethod || 'Bank Transfer')}</span>
        ${statusBadge(order.status)}
      </div>
      <div class="lc-order__pay">
        <span class="om-pay-status${order.paymentStatus === 'Paid' ? ' om-pay-status--paid' : order.paymentStatus === 'Awaiting Payment' ? ' om-pay-status--pending' : ''}">${esc(order.paymentStatus || 'Awaiting Payment')}</span>
        ${order.paymentReference ? `<span>Ref ${esc(order.paymentReference)}</span>` : ''}
      </div>
      <div class="lc-proofs">${proofMarkup}</div>
      ${proofs.length && proofs[proofs.length - 1].status !== 'accepted'
        ? `<div class="lc-order__actions">
             <button class="admin-btn admin-btn--tiny admin-btn--primary" type="button" data-lc-proof="accepted">Approve slip · mark paid</button>
             <button class="admin-btn admin-btn--tiny admin-btn--danger" type="button" data-lc-proof="rejected">Ask for a new slip</button>
           </div>`
        : ''}
    </div>`;
  }

  function paymentChipsMarkup() {
    const methods = (chat.payments?.methods || []).filter((method) => method.fields.length || method.qr);
    if (!methods.length) return '';
    return `<div class="lc-chips" aria-label="Send payment details">
      ${methods.map((method) => `<button class="lc-chip" type="button" data-lc-pay="${esc(method.key)}">${esc(method.label)}</button>`).join('')}
    </div>`;
  }

  function renderChatThread() {
    if (!els.lcThread) return;
    if (!chat.thread) {
      els.lcThread.innerHTML = `<div class="lc-blank">
        <strong>Pick a conversation</strong>
        <p>Open a customer on the left to read the full thread and reply. New messages appear without refreshing.</p>
      </div>`;
      return;
    }
    const conversation = chat.thread;
    els.lcThread.innerHTML = `<header class="lc-cust">
        <button class="admin-icon-btn lc-cust__back" type="button" aria-label="Back to conversations" data-lc-back>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>
        </button>
        <span class="lc-row__avatar">${esc(initialsOf(conversation.name))}</span>
        <span class="lc-cust__id">
          <strong>${esc(conversation.name || 'Guest')}</strong>
          <span>${esc(conversation.email || conversation.phone || conversation.id)}${conversation.orderNumber ? ` · Order ${esc(conversation.orderNumber)}` : ''}</span>
        </span>
        <span class="lc-cust__state${chat.customerOnline ? ' is-online' : ''}" data-lc-state>${chat.customerOnline ? 'Online now' : 'Offline'}</span>
        <button class="admin-btn admin-btn--tiny" type="button" data-lc-resolve="${conversation.status === 'open' ? 'resolved' : 'open'}">
          ${conversation.status === 'open' ? 'Mark resolved' : 'Reopen chat'}
        </button>
      </header>
      ${orderContextMarkup()}
      <div class="lc-msgs" data-lc-msgs></div>
      <p class="lc-typing" data-lc-typingline${chat.typingIds.has(conversation.id) ? '' : ' hidden'}>Customer is typing…</p>
      <p class="lc-seen" data-lc-seen hidden></p>
      <div class="lc-attach" data-lc-attachpreview hidden>
        <img alt="" data-lc-attachthumb>
        <span>Slip ready to send</span>
        <button type="button" aria-label="Remove attachment" data-lc-attachclear>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </div>
      ${paymentChipsMarkup()}
      <form class="lc-compose" data-lc-compose>
        <button class="lc-compose__attach" type="button" aria-label="Attach an image" data-lc-attach>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/></svg>
        </button>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-lc-file>
        <textarea class="admin-textarea" rows="1" placeholder="Reply to ${esc(conversation.name || 'the customer')}…" maxlength="2000" data-lc-input></textarea>
        <button class="admin-btn admin-btn--primary" type="submit">Send</button>
      </form>
      <p class="admin-form-error" role="alert" data-lc-error></p>`;

    const msgs = $('[data-lc-msgs]', els.lcThread);
    chat.rendered = new Set();
    for (const message of conversation.thread || []) {
      chat.rendered.add(message.id);
      msgs.insertAdjacentHTML('beforeend', chatBubble(message));
    }
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function scrollThreadToEnd() {
    const msgs = $('[data-lc-msgs]', els.lcThread);
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function threadAppend(message) {
    const msgs = $('[data-lc-msgs]', els.lcThread);
    if (!msgs || chat.rendered.has(message.id)) return;
    chat.rendered.add(message.id);
    msgs.insertAdjacentHTML('beforeend', chatBubble(message));
    scrollThreadToEnd();
  }

  function threadRemove(messageId) {
    const msgs = $('[data-lc-msgs]', els.lcThread);
    const id = String(messageId || '');
    if (msgs) {
      for (const node of Array.from(msgs.children)) {
        if (node.dataset.message === id) node.remove();
      }
    }
    chat.rendered.delete(id);
    if (chat.thread?.thread) {
      chat.thread.thread = chat.thread.thread.filter((entry) => entry.id !== id);
    }
  }

  // The server deletes the stored attachment too (server.js:3948-3972), so the
  // confirm has to be explicit about it being permanent.
  async function deleteChatMessage(messageId) {
    if (!chat.activeId || !messageId) return;
    if (!canModerateMessages()) {
      toast('Your employee account cannot delete messages.', true);
      return;
    }
    if (!window.confirm('Delete this message from the conversation? The customer loses it immediately and any attached image is removed. This cannot be undone.')) return;
    try {
      const data = await request(
        `/api/admin/chat/${encodeURIComponent(chat.activeId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' }
      );
      threadRemove(messageId);
      if (data.conversation) mergeConversation(data.conversation);
      toast('Message deleted.');
    } catch (error) {
      toast(error.message, true);
    }
  }

  // A deleted conversation disappears from this desk because the server stopped
  // listing it; the open thread is cleared rather than left stale.
  function dropConversation(conversationId) {
    const id = String(conversationId || '');
    if (!id) return;
    chat.conversations = chat.conversations.filter((entry) => entry.id !== id);
    if (chat.activeId === id) {
      chat.activeId = '';
      chat.thread = null;
      chat.order = null;
      chat.customer = null;
      chat.rendered = new Set();
      renderChatThread();
    }
    renderChatList();
    updateBadges();
  }

  // Unread counters arrive on the `notification` event (server.js:1384-1400);
  // `byConversation` is a per-conversation list, so the rows can be updated
  // without refetching the inbox.
  function applyUnreadPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    chat.unreadAdmin = Number(payload.unreadAdmin) || 0;
    const perConversation = Array.isArray(payload.byConversation) ? payload.byConversation : [];
    if (perConversation.length) {
      const totals = new Map(perConversation.map((entry) => [entry.id, Number(entry.unread) || 0]));
      for (const entry of chat.conversations) {
        const value = totals.get(entry.id);
        if (value === undefined) continue;
        entry.unread = { ...(entry.unread || {}), admin: value };
      }
    } else if (!chat.conversations.length && Number.isFinite(Number(payload.unreadAdmin))) {
      chat.unreadAdmin = Number(payload.unreadAdmin) || 0;
    }
    renderChatList();
    updateBadges();
  }

  function clearConversationUnread(conversationId) {
    const row = chat.conversations.find((entry) => entry.id === conversationId);
    if (row?.unread) row.unread.admin = 0;
    if (chat.thread?.id === conversationId && chat.thread.unread) chat.thread.unread.admin = 0;
    renderChatList();
    updateBadges();
  }

  // Notification permission is asked for the first time the desk is opened, so
  // the storefront admin never shows a permission prompt on load.
  function askNotificationPermission() {
    if (typeof window.Notification !== 'function') return;
    if (Notification.permission !== 'default') return;
    Notification.requestPermission()
      .then(() => setNotificationHint())
      .catch(() => {});
  }

  function setNotificationHint() {
    if (!els.lcNotify) return;
    const supported = typeof window.Notification === 'function';
    if (!supported) {
      els.lcNotify.textContent = 'This browser cannot show desktop notifications.';
      els.lcNotify.hidden = false;
      return;
    }
    if (Notification.permission === 'denied') {
      els.lcNotify.textContent = 'Desktop notifications are blocked in this browser. New messages still arrive live.';
      els.lcNotify.hidden = false;
      return;
    }
    els.lcNotify.hidden = true;
    els.lcNotify.textContent = '';
  }

  function notifyNewMessage(message, conversationId) {
    if (typeof window.Notification !== 'function' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    if (!message || message.from !== 'customer') return;
    const row = chat.conversations.find((entry) => entry.id === conversationId);
    const body = String(message.text || (message.attachment ? 'Sent an image' : 'New message')).slice(0, 180);
    try {
      const note = new Notification(row?.name || row?.email || 'New chat message', {
        body,
        tag: `velune-chat-${conversationId}`,
        icon: '/favicon.svg'
      });
      note.onclick = () => {
        window.focus();
        note.close();
        if (conversationId) openChat(conversationId).catch(() => {});
      };
      setTimeout(() => note.close(), 12000);
    } catch {
      /* notification construction can fail outside a secure context */
    }
  }

  function mergeConversation(summary) {
    if (!summary) return;
    const index = chat.conversations.findIndex((entry) => entry.id === summary.id);
    // Reading a thread in this desk means its badge is stale the moment it is
    // merged, otherwise a message arriving while the thread is open would keep
    // counting itself as unread.
    if (summary.id === chat.activeId && summary.unread) summary.unread = { ...summary.unread, admin: 0 };
    if (index === -1) {
      chat.conversations.unshift(summary);
    } else {
      chat.conversations[index] = { ...chat.conversations[index], ...summary };
    }
    chat.conversations.sort((left, right) => new Date(right.lastMessageAt || 0) - new Date(left.lastMessageAt || 0));
    renderChatList();
    updateBadges();
  }

  async function loadChat() {
    const data = await request('/api/admin/chat');
    chat.conversations = data.conversations || [];
    chat.payments = data.payments || null;
    chat.onlineIds = new Set(data.online || []);
    chat.unreadAdmin = deskUnreadTotal(data);
    renderChatList();
    updateBadges();
    setNotificationHint();
    setLiveState('Live', 'ok');
    connectChatStream();
  }

  async function openChat(id) {
    let data;
    try {
      data = await request(`/api/admin/chat/${encodeURIComponent(id)}`);
    } catch (error) {
      // Scoped agents are shown only their own and unclaimed threads, so a
      // thread claimed by another agent between the list and the click must
      // leave the inbox instead of sitting there unreadable (server.js:529).
      if (String(error.message || '').toLowerCase().includes('another agent')) {
        dropConversation(id);
        toast('That conversation belongs to another agent.');
        return;
      }
      toast(error.message, true);
      return;
    }
    chat.activeId = id;
    chat.thread = data.conversation;
    chat.order = data.order;
    chat.customer = data.customer;
    chat.customerOnline = Boolean(data.customerOnline);
    chat.payments = data.payments || chat.payments;
    renderChatThread();
    renderChatList();
    const row = chat.conversations.find((entry) => entry.id === id);
    if (row && row.unread) row.unread.admin = 0;
    updateBadges();
    request(`/api/admin/chat/${encodeURIComponent(id)}`, { method: 'PATCH', json: { read: true } }).catch(() => {});
    const input = $('[data-lc-input]', els.lcThread);
    if (input) input.focus();
  }

  async function patchChat(body) {
    if (!chat.activeId) return null;
    const errorNode = $('[data-lc-error]', els.lcThread);
    if (errorNode) errorNode.textContent = '';
    try {
      return await request(`/api/admin/chat/${encodeURIComponent(chat.activeId)}`, { method: 'PATCH', json: body });
    } catch (error) {
      if (errorNode) errorNode.textContent = error.message;
      else toast(error.message, true);
      return null;
    }
  }

  async function sendReply(body, button) {
    if (button) button.disabled = true;
    try {
      const result = await patchChat(body);
      if (result?.message) threadAppend(result.message);
      if (result?.conversation) mergeConversation({ ...result.conversation, unread: { ...result.conversation.unread, admin: 0 } });
      return result;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setLiveState(text, kind) {
    if (!els.lcLive) return;
    els.lcLive.textContent = text;
    els.lcLive.className = `lc-live${kind === 'ok' ? ' is-live' : kind === 'slow' ? ' is-slow' : ''}`;
    els.lcLive.insertAdjacentHTML('afterbegin', '<i></i>');
  }

  function connectChatStream() {
    closeChatStream();
    request('/api/admin/chat/stream-ticket', { method: 'POST', json: {} })
      .then((data) => {
        if (state.route !== 'chat') return;
        if (!window.EventSource) {
          startChatPoll();
          return;
        }
        chat.stream = new EventSource(`/api/admin/chat/stream?sset=${encodeURIComponent(data.token)}`);
        chat.stream.addEventListener('hello', (event) => {
          chat.attempts = 0;
          const payload = JSON.parse(event.data);
          chat.conversations = payload.conversations || chat.conversations;
          chat.onlineIds = new Set(payload.online || []);
          renderChatList();
          updateBadges();
          setLiveState('Live', 'ok');
        });
        chat.stream.addEventListener('message', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.conversation) mergeConversation(payload.conversation);
          if (payload.message) {
            if (payload.conversationId === chat.activeId) {
              threadAppend(payload.message);
              chat.typingIds.delete(payload.conversationId);
              const line = $('[data-lc-typingline]', els.lcThread);
              if (line) line.hidden = true;
            }
            if (payload.message.from === 'customer' && payload.message.attachment?.orderNumber) refreshChatOrder(payload.message.attachment.orderNumber);
            notifyNewMessage(payload.message, payload.conversationId);
          }
        });
        chat.stream.addEventListener('notification', (event) => {
          applyUnreadPayload(JSON.parse(event.data));
        });
        chat.stream.addEventListener('read', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.side === 'admin') clearConversationUnread(payload.conversationId);
        });
        chat.stream.addEventListener('seen', (event) => {
          const payload = JSON.parse(event.data);
          if (!payload.at || chat.activeId !== payload.conversationId) return;
          const line = $('[data-lc-seen]', els.lcThread);
          if (line) {
            line.textContent = `Customer seen the messages · ${dateTime(payload.at)}`;
            line.hidden = false;
          }
        });
        chat.stream.addEventListener('message-deleted', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.conversationId === chat.activeId && payload.messageId) threadRemove(payload.messageId);
          if (payload.conversation) mergeConversation(payload.conversation);
        });
        chat.stream.addEventListener('conversation-deleted', (event) => {
          const payload = JSON.parse(event.data);
          dropConversation(payload.conversationId);
        });
        chat.stream.addEventListener('typing', (event) => {
          const payload = JSON.parse(event.data);
          const id = payload.conversationId;
          if (!id) return;
          if (payload.typing) chat.typingIds.add(id);
          else chat.typingIds.delete(id);
          if (id === chat.activeId) {
            const line = $('[data-lc-typingline]', els.lcThread);
            if (line) line.hidden = !payload.typing;
          }
        });
        chat.stream.addEventListener('presence', (event) => {
          const payload = JSON.parse(event.data);
          chat.onlineIds = new Set(payload.onlineConversations || []);
          renderChatList();
          if (chat.thread) {
            const state = $('[data-lc-state]', els.lcThread);
            const online = chat.onlineIds.has(chat.thread.id);
            if (state) {
              state.textContent = online ? 'Online now' : 'Offline';
              state.classList.toggle('is-online', online);
            }
          }
        });
        chat.stream.addEventListener('updated', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.conversation) mergeConversation(payload.conversation);
        });
        chat.stream.addEventListener('status', (event) => {
          const payload = JSON.parse(event.data);
          if (chat.thread && chat.thread.id === payload.conversationId) {
            chat.thread.status = payload.status;
            renderChatThread();
          }
        });
        chat.stream.addEventListener('proof', (event) => {
          const payload = JSON.parse(event.data);
          toast(`Payment slip uploaded for ${payload.orderNumber}`, false);
          refreshChatOrder(payload.orderNumber);
          if (state.orders) loadOrders().catch(() => {});
        });
        chat.stream.addEventListener('payment', (event) => {
          const payload = JSON.parse(event.data);
          refreshChatOrder(payload.orderNumber);
        });
        chat.stream.onerror = () => {
          if (state.route !== 'chat') return closeChatStream();
          if (chat.attempts >= 3) {
            closeChatStream();
            setLiveState('Reconnecting by refresh', 'slow');
            startChatPoll();
            return;
          }
          chat.attempts += 1;
          closeChatStream();
          setLiveState('Reconnecting…', 'slow');
          setTimeout(connectChatStream, 4000);
        };
      })
      .catch(() => {
        setLiveState('Not connected', 'slow');
        startChatPoll();
      });
  }

  function closeChatStream() {
    if (chat.stream) {
      chat.stream.close();
      chat.stream = null;
    }
    if (chat.pollTimer) {
      clearInterval(chat.pollTimer);
      chat.pollTimer = null;
    }
  }

  function startChatPoll() {
    if (chat.pollTimer) return;
    chat.pollTimer = setInterval(() => {
      if (state.route === 'chat') loadChat().catch(() => setLiveState('Not connected', 'slow'));
    }, 20000);
  }

  async function refreshChatOrder(number) {
    if (!number || !chat.order || chat.order.number !== number) return;
    try {
      const orders = await request('/api/admin/orders');
      state.orders = orders.orders;
      chat.order = orders.orders.find((order) => order.number === number) || null;
      renderChatThread();
    } catch {
      /* the order panel refreshes on the next open */
    }
  }

  // Conversation list, thread and composer events.
  els.lcList?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-lc-open]');
    if (row) openChat(row.dataset.lcOpen);
  });

  $$('[data-lc-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      chat.filter = button.dataset.lcFilter;
      $$('[data-lc-filter]').forEach((entry) => entry.classList.toggle('is-active', entry === button));
      renderChatList();
    });
  });

  els.lcSearch?.addEventListener('input', () => {
    chat.term = (els.lcSearch.value || '').trim();
    renderChatList();
  });

  els.lcThread?.addEventListener('click', async (event) => {
    const removeMessage = event.target.closest('[data-lc-del]');
    if (removeMessage) {
      const button = removeMessage;
      button.disabled = true;
      await deleteChatMessage(button.dataset.lcDel);
      button.disabled = false;
      return;
    }
    const open = event.target.closest('[data-lc-open]');
    if (open) {
      openChat(open.dataset.lcOpen);
      return;
    }
    if (event.target.closest('[data-lc-back]')) {
      chat.activeId = '';
      chat.thread = null;
      renderChatThread();
      renderChatList();
      els.lcSearch?.focus();
      return;
    }
    const resolve = event.target.closest('[data-lc-resolve]');
    if (resolve) {
      const next = resolve.dataset.lcResolve;
      const result = await patchChat({ status: next });
      if (result?.conversation) {
        chat.thread = result.conversation;
        mergeConversation(result.conversation);
        renderChatThread();
      }
      return;
    }
    const payChip = event.target.closest('[data-lc-pay]');
    if (payChip) {
      const method = (chat.payments?.methods || []).find((entry) => entry.key === payChip.dataset.lcPay);
      if (!method) return;
      const button = payChip;
      button.disabled = true;
      await sendReply({
        text: `Here are our ${method.label} payment details for ${chat.order ? `order ${chat.order.number}` : 'your order'}.`,
        paymentInfo: {
          heading: `${method.label} — ${method.name}`,
          lines: method.fields,
          note: method.note || ''
        }
      }, button);
      button.disabled = false;
      return;
    }
    const decision = event.target.closest('[data-lc-proof]');
    if (decision) {
      if (!chat.order) return;
      const note = decision.dataset.lcProof === 'rejected' ? 'The slip was not readable — please send another.' : '';
      decision.disabled = true;
      try {
        const result = await request(`/api/admin/orders/${encodeURIComponent(chat.order.number)}`, {
          method: 'PATCH',
          json: { proofDecision: decision.dataset.lcProof, proofNote: note }
        });
        chat.order = result.order;
        renderChatThread();
        toast(decision.dataset.lcProof === 'accepted' ? 'Payment marked as paid.' : 'Asked the customer for a new slip.');
        if (note) sendReply({ text: `${note} Order ${chat.order.number}.` });
        await loadOrders().catch(() => {});
      } catch (error) {
        toast(error.message, true);
        decision.disabled = false;
      }
      return;
    }
    const attach = event.target.closest('[data-lc-attach]');
    if (attach) {
      $('[data-lc-file]', els.lcThread)?.click();
      return;
    }
    if (event.target.closest('[data-lc-attachclear]')) {
      chat.pendingAttachment = null;
      const preview = $('[data-lc-attachpreview]', els.lcThread);
      if (preview) preview.hidden = true;
    }
  });

  els.lcThread?.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-lc-compose]');
    if (!form) return;
    event.preventDefault();
    const input = $('[data-lc-input]', form);
    const text = (input?.value || '').trim();
    if (!text && !chat.pendingAttachment) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const result = await sendReply({ text, attachment: chat.pendingAttachment || undefined }, button);
    if (result) {
      if (input) input.value = '';
      chat.pendingAttachment = null;
      const preview = $('[data-lc-attachpreview]', els.lcThread);
      if (preview) preview.hidden = true;
      if (button) button.disabled = false;
    } else if (button) {
      button.disabled = false;
    }
  });

  els.lcThread?.addEventListener('input', (event) => {
    if (!event.target.matches('[data-lc-input]')) return;
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
    if (!chat.activeId) return;
    if (!chat.typingSent) {
      chat.typingSent = true;
      request(`/api/admin/chat/${encodeURIComponent(chat.activeId)}/typing`, { method: 'POST', json: { typing: true } }).catch(() => {});
    }
    clearTimeout(chat.typingTimer);
    chat.typingTimer = setTimeout(() => {
      chat.typingSent = false;
      request(`/api/admin/chat/${encodeURIComponent(chat.activeId)}/typing`, { method: 'POST', json: { typing: false } }).catch(() => {});
    }, 2500);
  });

  els.lcThread?.addEventListener('change', (event) => {
    const fileInput = event.target.closest('[data-lc-file]');
    if (!fileInput) return;
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast('Upload a JPG, PNG or WebP image.', true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Images must be 5 MB or smaller.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const saved = await request('/api/admin/uploads', {
          method: 'POST',
          json: { mime: file.type, data: String(reader.result) }
        });
        chat.pendingAttachment = { path: saved.path, mime: file.type, bytes: saved.bytes, kind: 'slip' };
        const preview = $('[data-lc-attachpreview]', els.lcThread);
        const thumb = $('[data-lc-attachthumb]', els.lcThread);
        if (thumb) thumb.src = saved.path;
        if (preview) preview.hidden = false;
      } catch (error) {
        toast(error.message, true);
      }
    };
    reader.readAsDataURL(file);
  });

  els.lcThread?.addEventListener('keydown', (event) => {
    if (event.target.matches('[data-lc-input]') && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.target.closest('[data-lc-compose]')?.requestSubmit();
    }
  });

  // ---------------------------------------------------------------- payment channels

  function renderPaymentsPanel() {
    if (!els.paymentsGrid || !state.settings?.payments) return;
    const payments = state.settings.payments;
    els.paymentsGrid.innerHTML = (payments.methods || [])
      .map(
        (method) => `<article class="pm-card${method.enabled ? ' is-on' : ''}" data-pm="${esc(method.key)}">
          <div class="pm-card__head">
            <label class="admin-check">
              <input type="checkbox" data-pm-enabled${method.enabled ? ' checked' : ''}>
              <span>Offer at checkout</span>
            </label>
            <strong>${esc(method.storeName)}</strong>
          </div>
          <div class="pm-card__fields">
            ${method.fields
              .map(
                (field) => `<label class="admin-field">
                  <span>${esc(field.label)}${field.required ? ' <em>required</em>' : ''}</span>
                  <input class="admin-input" data-pm-field="${esc(field.key)}" maxlength="200" value="${esc(field.value)}" placeholder="${esc(field.label)}">
                </label>`
              )
              .join('')}
            <label class="admin-field">
              <span>Display name</span>
              <input class="admin-input" data-pm-label maxlength="60" value="${esc(method.label)}">
            </label>
            <label class="admin-field admin-field--wide">
              <span>Customer note</span>
              <input class="admin-input" data-pm-note maxlength="300" value="${esc(method.note)}">
            </label>
          </div>
          <div class="pm-card__qr">
            ${method.qr ? `<img src="${esc(method.qr)}" alt="${esc(method.storeName)} QR" width="88" height="88"><button class="admin-btn admin-btn--tiny" type="button" data-pm-qr-clear>Remove QR</button>` : '<span class="admin-muted">No QR uploaded.</span>'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-pm-qr-file>
            <button class="admin-btn admin-btn--tiny admin-btn--outline" type="button" data-pm-qr>Upload QR</button>
          </div>
        </article>`
      )
      .join('');
    if (els.paymentInstructions) els.paymentInstructions.value = payments.instructions || '';
  }

  function collectPayments() {
    const methods = {};
    $$('.pm-card', els.paymentsGrid || document).forEach((card) => {
      const key = card.dataset.pm;
      const fields = {};
      $$('[data-pm-field]', card).forEach((input) => {
        fields[input.dataset.pmField] = input.value.trim();
      });
      const qr = state.settings?.payments?.methods?.find((entry) => entry.key === key)?.qr || '';
      methods[key] = {
        enabled: $('[data-pm-enabled]', card)?.checked === true,
        label: $('[data-pm-label]', card)?.value.trim() || '',
        note: $('[data-pm-note]', card)?.value.trim() || '',
        qr,
        fields
      };
    });
    return { methods, instructions: (els.paymentInstructions?.value || '').trim() };
  }

  els.paymentsGrid?.addEventListener('click', async (event) => {
    const clear = event.target.closest('[data-pm-qr-clear]');
    if (clear) {
      const card = clear.closest('.pm-card');
      const method = state.settings?.payments?.methods?.find((entry) => entry.key === card.dataset.pm);
      if (method) method.qr = '';
      renderPaymentsPanel();
      return;
    }
    const upload = event.target.closest('[data-pm-qr]');
    if (upload) {
      const card = upload.closest('.pm-card');
      card.querySelector('[data-pm-qr-file]')?.click();
    }
  });

  els.paymentsGrid?.addEventListener('change', async (event) => {
    const toggle = event.target.closest('[data-pm-enabled]');
    if (toggle) {
      toggle.closest('.pm-card')?.classList.toggle('is-on', toggle.checked);
      return;
    }
    const fileInput = event.target.closest('[data-pm-qr-file]');
    if (!fileInput) return;
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      toast('QR must be a JPG, PNG or WebP under 5 MB.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const saved = await request('/api/admin/uploads', { method: 'POST', json: { mime: file.type, data: String(reader.result) } });
        const card = fileInput.closest('.pm-card');
        const method = state.settings?.payments?.methods?.find((entry) => entry.key === card?.dataset.pm);
        if (method) method.qr = saved.path;
        renderPaymentsPanel();
        toast('QR uploaded. Save payment channels to publish it.');
      } catch (error) {
        toast(error.message, true);
      }
    };
    reader.readAsDataURL(file);
  });

  els.paymentsSave?.addEventListener('click', async () => {
    if (els.paymentsError) els.paymentsError.textContent = '';
    els.paymentsSave.disabled = true;
    els.paymentsSave.textContent = 'Saving…';
    try {
      const result = await request('/api/admin/settings', { method: 'PATCH', json: { payments: collectPayments() } });
      state.settings = result.settings;
      renderPaymentsPanel();
      toast('Payment channels saved.');
    } catch (error) {
      if (els.paymentsError) els.paymentsError.textContent = error.message;
    } finally {
      els.paymentsSave.disabled = false;
      els.paymentsSave.textContent = 'Save payment channels';
    }
  });

  // ---------------------------------------------------------------- boot

  if (els.date) {
    els.date.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).format(new Date());
  }

  if (state.token) {
    startSession();
  } else {
    showLogin();
  }
})();
