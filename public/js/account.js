/* VELUNE — account */
(() => {
  'use strict';

  const { $, $$, api, esc, money, setCustomerToken, toast } = window.VELUNE;

  const state = { customer: null, orders: [], verification: null };

  const els = {
    loading: $('[data-account-loading]'),
    authView: $('[data-auth-view]'),
    accountView: $('[data-account-view]'),
    loginForm: $('[data-login-form]'),
    registerForm: $('[data-register-form]'),
    profileForm: $('[data-profile-form]'),
    passwordForm: $('[data-password-form]'),
    orders: $('[data-account-orders]'),
    accountDot: $('[data-account-dot]')
  };

  // ---------------------------------------------------------------- sign-up limits
  // These mirror the backend so the browser rejects the same inputs the server
  // would: server.js:262 (email), server.js:740 (mobile), server.js:2672
  // (password length), server.js:28 + 1009 (5 MB uploads), server.js:1040/1022
  // (minimum bytes), server.js:974-996 + 1024 (accepted image types).
  const MIN_PASSWORD = 10;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const MIN_AVATAR_BYTES = 128;
  const MIN_DOC_BYTES = 512;
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const DOC_TYPES = ['aadhaar', 'passport', 'driving-licence', 'voter-id'];
  const OTP_RESEND_SECONDS = 45;
  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;

  // Same rules as server.js:740 normaliseMobile, E.164 out.
  function normaliseMobile(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length > 10 && digits.length <= 15 && /^[1-9]\d{9,14}$/.test(digits)) return `+${digits}`;
    return '';
  }

  // A full address is never printed back to the screen.
  function maskEmail(value) {
    const email = String(value || '');
    const at = email.indexOf('@');
    if (at < 1) return '—';
    return `${email.charAt(0)}***@${email.slice(at + 1)}`;
  }

  function maskPhone(value) {
    const number = String(value || '');
    if (!number.startsWith('+')) return '—';
    const cc = number.startsWith('+91') ? '+91' : number.startsWith('+1') ? '+1' : number.slice(0, 3);
    const rest = number.slice(cc.length).replace(/\D/g, '');
    if (rest.length < 4) return '—';
    return `${cc} ${'•'.repeat(Math.max(4, rest.length - 2))} ${rest.slice(-2)}`;
  }

  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('That file could not be read. Try saving it again.'));
      reader.readAsDataURL(file);
    });
  }

  // Client-side guard for the private avatar store (server.js:1035).
  function checkImageFile(file, { minBytes, label }) {
    if (!file) return 'Choose a file first.';
    if (!IMAGE_TYPES.includes(file.type)) return `${label} must be a JPEG, PNG or WebP image.`;
    if (file.size < minBytes) return `That ${label.toLowerCase()} appears to be empty.`;
    if (file.size > MAX_UPLOAD_BYTES) return `${label} files must be 5 MB or smaller.`;
    return '';
  }

  // Client-side guard for identity documents (server.js:1011 — PDF allowed).
  function checkDocFile(file, label) {
    if (!file) return `Attach the ${label.toLowerCase()} of the document.`;
    const allowed = [...IMAGE_TYPES, 'application/pdf'];
    if (!allowed.includes(file.type)) return `${label} must be a JPEG, PNG, WebP image or a PDF.`;
    if (file.size < MIN_DOC_BYTES) return `The ${label.toLowerCase()} file appears to be empty.`;
    if (file.size > MAX_UPLOAD_BYTES) return `${label} files must be 5 MB or smaller.`;
    return '';
  }

  function passwordScore(value) {
    const text = String(value || '');
    if (text.length < MIN_PASSWORD) return 0;
    let score = 1;
    if (text.length >= 14) score += 1;
    if (/[a-z]/.test(text) && /[A-Z]/.test(text)) score += 1;
    if (/\d/.test(text) && /[^A-Za-z0-9]/.test(text)) score += 1;
    else if (/\d/.test(text) || /[^A-Za-z0-9]/.test(text)) score += 1;
    return Math.min(score, 4);
  }

  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  function setVisible(view) {
    if (els.loading) els.loading.hidden = true;
    if (els.authView) els.authView.hidden = view !== 'auth';
    if (els.accountView) els.accountView.hidden = view !== 'account';
  }

  function setTab(mode) {
    $$('[data-auth-tab]').forEach((button) => {
      const active = button.dataset.authTab === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-auth-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.authPanel !== mode;
    });
    const target = mode === 'register' ? $('#register-first') : $('#login-email');
    if (target) setTimeout(() => target.focus(), 60);
  }

  function fieldError(selector, message) {
    const node = $(selector);
    if (node) node.textContent = message || '';
  }

  // A missing element is never a crash in these flows.
  function setText(target, value) {
    const node = typeof target === 'string' ? $(target) : target;
    if (node) node.textContent = value;
  }

  function showAuth(mode = 'login') {
    setVisible('auth');
    setTab(mode);
  }

  function formatStatus(status) {
    return String(status || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function renderOrders() {
    if (!els.orders) return;
    if (!state.orders.length) {
      els.orders.innerHTML = `<div class="account-empty">
        <span class="account-empty__mark">V</span>
        <h3>No orders yet</h3>
        <p>Orders placed while signed in will appear here. Guest orders stay available through your receipt link.</p>
        <a class="btn btn--small" href="/shop">Explore the collection</a>
      </div>`;
      return;
    }
    els.orders.innerHTML = state.orders
      .map((order) => {
        const units = order.items.reduce((sum, item) => sum + Number(item.qty), 0);
        const thumbs = order.items
          .slice(0, 3)
          .map(
            (item) =>
              window.VELUNE.mediaThumb(item.image, { alt: item.name, width: 42, height: 52 })
          )
          .join('');
        const href = `/order?number=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.token)}`;
        return `<article class="account-order">
          <div class="account-order__head">
            <div>
              <a class="account-order__number" href="${href}">${esc(order.number)}</a>
              <span>${esc(dateFormat.format(new Date(order.createdAt)))} · ${units} ${units === 1 ? 'item' : 'items'}</span>
            </div>
            <span class="order-status order-status--${esc(formatStatus(order.status))}">${esc(order.status)}</span>
          </div>
          <div class="account-order__body">
            <div class="account-order__thumbs">${thumbs}${order.items.length > 3 ? `<span>+${order.items.length - 3}</span>` : ''}</div>
            <div class="account-order__total">
              <span>Total</span>
              <strong>${money(order.total)}</strong>
            </div>
            <a class="btn btn--small btn--outline" href="${href}">View order</a>
          </div>
        </article>`;
      })
      .join('');
  }

  async function loadOrders() {
    if (!els.orders) return;
    try {
      const data = await api('/api/account/orders');
      state.orders = data.orders || [];
      renderOrders();
    } catch (error) {
      els.orders.innerHTML = `<div class="account-empty"><p>${esc(error.message)}</p></div>`;
    }
  }

  function fillProfile(customer) {
    const first = $('[data-account-first]');
    if (first) first.textContent = customer.firstName;
    const email = $('[data-account-email]');
    if (email) email.textContent = customer.email;
    const since = $('[data-account-since]');
    if (since) since.textContent = customer.createdAt ? dateFormat.format(new Date(customer.createdAt)) : '—';
    const count = $('[data-account-order-count]');
    if (count) count.textContent = String(state.orders.length);
    const profile = els.profileForm;
    if (profile) {
      profile.querySelector('[name="firstName"]').value = customer.firstName || '';
      profile.querySelector('[name="lastName"]').value = customer.lastName || '';
      profile.querySelector('[name="email"]').value = customer.email || '';
      profile.querySelector('[name="phone"]').value = customer.phone || '';
      profile.querySelector('[name="marketingOptIn"]').checked = Boolean(customer.marketingOptIn);
    }
  }

  async function showAccount(customer) {
    state.customer = customer;
    setVisible('account');
    if (els.accountDot) els.accountDot.hidden = false;
    fillProfile(customer);
    await loadOrders();
    const count = $('[data-account-order-count]');
    if (count) count.textContent = String(state.orders.length);
    await loadVerification();
    await loadAvatar();
  }

  async function completeAuth(data) {
    state.customer = data.customer;
    if (data.token) setCustomerToken(data.token);
    if (els.accountDot) els.accountDot.hidden = false;
    if (data.customer) {
      toast(`Welcome, ${data.customer.firstName}.`);
      if (window.location.pathname !== '/account') {
        window.history.replaceState({}, '', '/account');
      }
      await showAccount(data.customer);
    }
  }

  $$('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.authTab));
  });

  els.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError('[data-auth-error]', '');
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = $('[data-login-submit]', form);
    if (button) {
      button.disabled = true;
      button.textContent = 'Signing in…';
    }
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        json: {
          email: String(data.get('email') || '').trim(),
          password: String(data.get('password') || '')
        }
      });
      form.reset();
      await completeAuth(result);
    } catch (error) {
      fieldError('[data-auth-error]', error.message);
      const password = form.querySelector('[name="password"]');
      if (password) password.focus();
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    }
  });

  // ---------------------------------------------------------------- create account
  const registerDraft = { avatar: null, docFront: null, docBack: null };

  function registerFieldError(key, message) {
    const node = $(`[data-register-field-error="${key}"]`);
    if (node) node.textContent = message || '';
    const input = els.registerForm?.querySelector(`[name="${key}"]`);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearRegisterErrors() {
    ['firstName', 'lastName', 'email', 'mobile', 'password', 'confirmPassword'].forEach((key) => registerFieldError(key, ''));
    fieldError('[data-register-error]', '');
    fieldError('[data-register-avatar-error]', '');
    fieldError('[data-register-doc-error]', '');
  }

  function bindRegisterPickers() {
    const form = els.registerForm;
    if (!form) return;

    const password = form.querySelector('[name="password"]');
    const confirm = form.querySelector('[name="confirmPassword"]');
    const bar = $('[data-register-pwd-bar]');
    const hint = $('[data-register-pwd-hint]');
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

    const paintStrength = () => {
      const value = password ? password.value : '';
      const score = passwordScore(value);
      if (bar) {
        bar.style.width = `${(score / 4) * 100}%`;
        bar.dataset.level = String(score);
      }
      if (hint) {
        if (!value.length) hint.textContent = 'At least 10 characters. Mixed case with a number is stronger.';
        else if (value.length < MIN_PASSWORD) hint.textContent = `${MIN_PASSWORD - value.length} more character${MIN_PASSWORD - value.length === 1 ? '' : 's'} needed.`;
        else hint.textContent = `Password strength: ${labels[score]}.`;
      }
      if (confirm && confirm.value) {
        registerFieldError('confirmPassword', confirm.value === value ? '' : 'The two passwords do not match.');
      }
    };
    password?.addEventListener('input', paintStrength);
    confirm?.addEventListener('input', paintStrength);

    const avatarInput = $('[data-register-avatar-input]');
    const avatarName = $('[data-register-avatar-name]');
    const avatarPreview = $('[data-register-avatar-preview]');
    $('[data-register-avatar-btn]')?.addEventListener('click', () => avatarInput?.click());
    avatarInput?.addEventListener('change', () => {
      const file = avatarInput.files?.[0] || null;
      avatarInput.value = '';
      fieldError('[data-register-avatar-error]', '');
      if (!file) {
        registerDraft.avatar = null;
        if (avatarName) avatarName.textContent = 'No picture selected';
        if (avatarPreview) {
          avatarPreview.hidden = true;
          if (avatarPreview.src.startsWith('blob:')) URL.revokeObjectURL(avatarPreview.src);
        }
        return;
      }
      const problem = checkImageFile(file, { minBytes: MIN_AVATAR_BYTES, label: 'Profile picture' });
      if (problem) {
        registerDraft.avatar = null;
        fieldError('[data-register-avatar-error]', problem);
        if (avatarName) avatarName.textContent = 'No picture selected';
        return;
      }
      registerDraft.avatar = file;
      if (avatarName) avatarName.textContent = `${file.name} · ${Math.round(file.size / 1024)} KB`;
      if (avatarPreview) {
        if (avatarPreview.src.startsWith('blob:')) URL.revokeObjectURL(avatarPreview.src);
        avatarPreview.src = URL.createObjectURL(file);
        avatarPreview.hidden = false;
      }
    });

    const frontInput = $('[data-register-doc-front-input]');
    const backInput = $('[data-register-doc-back-input]');
    $('[data-register-doc-front-btn]')?.addEventListener('click', () => frontInput?.click());
    $('[data-register-doc-back-btn]')?.addEventListener('click', () => backInput?.click());
    frontInput?.addEventListener('change', () => {
      const file = frontInput.files?.[0] || null;
      frontInput.value = '';
      registerDraft.docFront = file;
      fieldError('[data-register-doc-error]', '');
      setText('[data-register-doc-front-name]', file ? `${file.name} · ${Math.round(file.size / 1024)} KB` : 'No file chosen');
    });
    backInput?.addEventListener('change', () => {
      const file = backInput.files?.[0] || null;
      backInput.value = '';
      registerDraft.docBack = file;
      fieldError('[data-register-doc-error]', '');
      setText('[data-register-doc-back-name]', file ? `${file.name} · ${Math.round(file.size / 1024)} KB` : 'No file chosen');
    });
  }

  bindRegisterPickers();

  els.registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearRegisterErrors();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      email: String(data.get('email') || '').trim().toLowerCase(),
      mobile: normaliseMobile(data.get('mobile')),
      password: String(data.get('password') || ''),
      confirmPassword: String(data.get('confirmPassword') || '')
    };

    const errors = {};
    if (values.firstName.length < 2) errors.firstName = 'Please enter your first name.';
    if (values.lastName.length < 2) errors.lastName = 'Please enter your surname.';
    if (!isEmail(values.email)) errors.email = 'Enter a valid email address.';
    if (!values.mobile) errors.mobile = 'Enter a valid mobile number, for example 98765 43210 or +1 415 555 0132.';
    if (values.password.length < MIN_PASSWORD) errors.password = `Choose a password with at least ${MIN_PASSWORD} characters.`;
    if (values.password.length > 200) errors.password = 'That password is too long.';
    if (values.confirmPassword !== values.password) errors.confirmPassword = 'The two passwords do not match.';

    // Documents are a pair on the server too (server.js:1057), so half a pair
    // is caught here instead of letting the backend reject it after sign-up.
    const hasFront = Boolean(registerDraft.docFront);
    const hasBack = Boolean(registerDraft.docBack);
    const docType = String(form.querySelector('[data-register-doc-type]')?.value || '');
    let docProblem = '';
    if ((hasFront || hasBack) && !docType) docProblem = 'Choose the document type for the files you attached.';
    if (hasFront && !hasBack) docProblem = 'Both the front and the reverse are needed — upload them together.';
    else if (hasBack && !hasFront) docProblem = 'Both the front and the reverse are needed — upload them together.';
    if (!docProblem && hasFront) docProblem = checkDocFile(registerDraft.docFront, 'Front');
    if (!docProblem && hasBack) docProblem = checkDocFile(registerDraft.docBack, 'Reverse');
    if (docProblem) fieldError('[data-register-doc-error]', docProblem);

    Object.entries(errors).forEach(([key, message]) => registerFieldError(key, message));
    const firstBad = Object.keys(errors)[0];
    if (firstBad) {
      form.querySelector(`[name="${firstBad}"]`)?.focus();
      return;
    }
    if (docProblem) {
      form.querySelector('[data-register-doc-front-input]')?.focus();
      return;
    }

    const button = $('[data-register-submit]', form);
    if (button) {
      button.disabled = true;
      button.textContent = 'Creating account…';
    }
    try {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        mobile: values.mobile,
        password: values.password,
        confirmPassword: values.confirmPassword,
        marketingOptIn: data.get('marketingOptIn') === 'on',
        website: String(data.get('website') || '')
      };
      if (registerDraft.avatar) payload.profilePicture = await readFileDataUrl(registerDraft.avatar);

      const result = await api('/api/auth/register', { method: 'POST', json: payload });
      form.reset();
      const docs = { docType, front: registerDraft.docFront, back: registerDraft.docBack };
      registerDraft.avatar = null;
      registerDraft.docFront = null;
      registerDraft.docBack = null;
      setText('[data-register-avatar-name]', 'No picture selected');
      setText('[data-register-doc-front-name]', 'No file chosen');
      setText('[data-register-doc-back-name]', 'No file chosen');
      const preview = $('[data-register-avatar-preview]');
      if (preview) {
        preview.hidden = true;
        if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
        preview.removeAttribute('src');
      }
      if (button) button.textContent = 'Create account';

      await finishSignUp(result, docs);
    } catch (error) {
      fieldError('[data-register-error]', error.message);
      // The server names the duplicate field itself (server.js:2676/2679), so
      // the message is placed against that input as well.
      if (error.status === 409) {
        const key = /email/i.test(error.message) ? 'email' : 'mobile';
        registerFieldError(key, error.message);
        form.querySelector(`[name="${key}"]`)?.focus();
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Create account';
      }
    }
  });

  // The account exists and the session cookie is set by the register response
  // (server.js:2750); the codes it echoes drive the verification step.
  async function finishSignUp(result, docs) {
    state.customer = result.customer;
    if (result.token) setCustomerToken(result.token);
    if (els.accountDot) els.accountDot.hidden = false;
    if (window.location.pathname !== '/account') window.history.replaceState({}, '', '/account');

    openOtp('signup', { codes: result.codes || [], verification: result.verification });

    // Documents ride on the dedicated endpoint (15 MB body limit at
    // server.js:2847) rather than the 8 MB register body.
    if (docs?.docType && docs.front && docs.back) {
      try {
        const upload = await api('/api/account/verification/documents', {
          method: 'POST',
          json: {
            docType: docs.docType,
            front: await readFileDataUrl(docs.front),
            back: await readFileDataUrl(docs.back)
          }
        });
        renderVerification(upload.verification);
        setOtpStatus(upload.message || 'Documents received. An administrator will review them shortly.');
      } catch (error) {
        fieldError('[data-register-error]', `Account created, but the documents were not accepted: ${error.message}`);
      }
    } else if (result.verification) {
      renderVerification(result.verification);
    }
  }

  // ---------------------------------------------------------------- one-time codes
  // POST /api/auth/otp/request {purpose} and POST /api/auth/otp/verify
  // {purpose, code} (server.js:2788 and 2816). The panel reflects the server
  // rules: 6 digits, 10 minute expiry, 45 s resend cooldown, 5 codes per hour
  // and 6 wrong attempts before a code dies (server.js:732-736, 802-821).
  const OTP_PURPOSES = ['email', 'phone'];
  const OTP_OUTBOX_NOTE = 'Email and SMS delivery is not configured on this store yet, so codes are recorded for review rather than sent to your inbox.';
  const otpPanel = $('[data-otp-panel]');
  const otpSlots = { signup: $('[data-otp-slot="signup"]'), account: $('[data-otp-slot="account"]') };
  const otpState = { context: 'signup', email: null, phone: null };
  const otpTimers = { email: null, phone: null };

  function buildOtpBoxes() {
    OTP_PURPOSES.forEach((purpose) => {
      const wrap = $(`[data-otp-inputs="${purpose}"]`);
      if (!wrap || wrap.childElementCount) return;
      const label = purpose === 'email' ? 'Email code' : 'Mobile code';
      wrap.innerHTML = Array.from({ length: 6 }, (_, index) =>
        `<input class="otp-code__digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" ` +
        `autocomplete="${index === 0 ? 'one-time-code' : 'off'}" aria-label="${esc(label)} digit ${index + 1} of 6">`
      ).join('');
      const boxes = $$('input', wrap);
      boxes.forEach((box, index) => {
        box.addEventListener('input', () => {
          box.value = box.value.replace(/\D/g, '').slice(-1);
          setOtpError(purpose, '');
          if (box.value && index < 5) boxes[index + 1].focus();
        });
        box.addEventListener('keydown', (event) => {
          if (event.key === 'Backspace' && !box.value && index > 0) {
            event.preventDefault();
            boxes[index - 1].focus();
          } else if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault();
            boxes[index - 1].focus();
          } else if (event.key === 'ArrowRight' && index < 5) {
            event.preventDefault();
            boxes[index + 1].focus();
          }
        });
        // A pasted code is spread across the six boxes instead of landing in one.
        box.addEventListener('paste', (event) => {
          const digits = String(event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (!digits) return;
          event.preventDefault();
          boxes.forEach((entry, position) => {
            entry.value = digits.charAt(position) || '';
          });
          boxes[Math.min(digits.length, 5)].focus();
          setOtpError(purpose, '');
        });
      });
    });
  }

  function otpBoxes(purpose) {
    const wrap = $(`[data-otp-inputs="${purpose}"]`);
    return wrap ? $$('input', wrap) : [];
  }

  function otpDigits(purpose) {
    return otpBoxes(purpose).map((box) => box.value).join('');
  }

  function clearOtpInputs(purpose) {
    otpBoxes(purpose).forEach((box) => {
      box.value = '';
    });
  }

  function setOtpError(purpose, message) {
    const node = $(`[data-otp-error="${purpose}"]`);
    if (node) node.textContent = message || '';
    otpBoxes(purpose).forEach((box) => box.setAttribute('aria-invalid', message ? 'true' : 'false'));
  }

  function setOtpStatus(message) {
    const node = $('[data-otp-status]');
    if (node) node.textContent = message || '';
  }

  function refreshOtpHint(purpose) {
    const entry = otpState[purpose];
    const hint = $(`[data-otp-hint="${purpose}"]`);
    if (!entry || !hint) return;
    if (entry.resendIn > 0) {
      hint.textContent = `You can request another code in ${entry.resendIn} seconds.`;
      return;
    }
    if (entry.capReached) {
      hint.textContent = entry.capMessage || 'Too many codes requested for this detail. Please try again in an hour.';
      return;
    }
    if (entry.verified) {
      hint.textContent = 'Verified — nothing more to do here.';
      return;
    }
    if ((entry.delivered === false || entry.providers === false) && !entry.devCode) {
      hint.textContent = OTP_OUTBOX_NOTE;
      return;
    }
    if (entry.error) {
      hint.textContent = `Delivery note: ${entry.error}`;
      return;
    }
    const minutes = Math.max(1, Math.round((Number(entry.expiresInSeconds) || 600) / 60));
    hint.textContent = `The code expires in ${minutes} minutes. Up to 5 codes per hour, 6 tries per code.`;
  }

  function renderOtpChannel(purpose) {
    const entry = otpState[purpose];
    const block = $(`[data-otp-channel="${purpose}"]`);
    if (!entry || !block) return;
    const dest = $(`[data-otp-dest="${purpose}"]`);
    const dev = $(`[data-otp-dev="${purpose}"]`);
    const inputs = $(`[data-otp-inputs="${purpose}"]`);
    const actions = $('.otp-channel__actions', block);

    if (dest) dest.textContent = entry.destination;
    block.classList.toggle('is-done', Boolean(entry.verified));
    if (inputs) inputs.hidden = Boolean(entry.verified);
    if (actions) actions.hidden = Boolean(entry.verified);

    if (dev) {
      if (entry.devCode && !entry.verified) {
        dev.hidden = false;
        dev.innerHTML =
          '<p class="otp-dev__lead">Code for this build</p>' +
          `<p class="otp-dev__code">${esc(entry.devCode)}</p>` +
          '<p class="otp-dev__note">No email or SMS provider is configured, so the server echoed the code here for testing only. It has not been delivered to a live inbox.</p>';
      } else {
        dev.hidden = true;
        dev.innerHTML = '';
      }
    }
    refreshOtpHint(purpose);
  }

  function stopCooldown(purpose) {
    clearInterval(otpTimers[purpose]);
    otpTimers[purpose] = null;
    const button = $(`[data-otp-resend="${purpose}"]`);
    if (button) {
      button.disabled = false;
      button.textContent = 'Send a new code';
    }
  }

  function startCooldown(purpose, seconds) {
    const entry = otpState[purpose];
    if (!entry) return;
    entry.resendIn = Math.max(0, Math.round(Number(seconds) || OTP_RESEND_SECONDS));
    clearInterval(otpTimers[purpose]);
    const button = $(`[data-otp-resend="${purpose}"]`);
    if (!entry.resendIn) {
      stopCooldown(purpose);
      refreshOtpHint(purpose);
      return;
    }
    if (button) button.disabled = true;
    const tick = () => {
      entry.resendIn = Math.max(0, entry.resendIn - 1);
      if (button) button.textContent = entry.resendIn ? `Resend in ${entry.resendIn}s` : 'Send a new code';
      refreshOtpHint(purpose);
      if (!entry.resendIn) stopCooldown(purpose);
    };
    tick();
    otpTimers[purpose] = setInterval(tick, 1000);
  }

  function openOtp(context, init = {}) {
    if (!otpPanel) return;
    buildOtpBoxes();
    const slot = otpSlots[context] || otpSlots.signup;
    if (slot && otpPanel.parentElement !== slot) slot.appendChild(otpPanel);
    otpState.context = context;

    const info = init.verification || state.verification || null;
    const byPurpose = {};
    (init.codes || []).forEach((entry) => {
      if (entry && entry.purpose) byPurpose[entry.purpose] = entry;
    });

    OTP_PURPOSES.forEach((purpose) => {
      const dispatched = byPurpose[purpose];
      const contact = purpose === 'email' ? info?.email : info?.phone;
      const previous = otpState[purpose];
      otpState[purpose] = {
        purpose,
        verified: Boolean(contact?.verified ?? previous?.verified),
        destination: purpose === 'email' ? maskEmail(contact?.address || state.customer?.email) : maskPhone(contact?.number || state.customer?.phone),
        delivered: dispatched ? Boolean(dispatched.delivered) : null,
        devCode: dispatched?.devMode ? String(dispatched.code || '') : '',
        error: dispatched?.error || '',
        expiresInSeconds: dispatched?.expiresInSeconds || 600,
        resendIn: dispatched ? Math.max(0, Number(dispatched.resendAfterSeconds) || OTP_RESEND_SECONDS) : 0,
        providers: typeof info?.providersConfigured === 'boolean' ? info.providersConfigured : previous?.providers ?? null,
        capReached: false,
        capMessage: ''
      };
      clearOtpInputs(purpose);
      setOtpError(purpose, '');
      renderOtpChannel(purpose);
      if (otpState[purpose].resendIn) startCooldown(purpose, otpState[purpose].resendIn);
      else stopCooldown(purpose);
    });

    const closeBtn = $('[data-otp-close]');
    if (closeBtn) closeBtn.hidden = context !== 'account';
    const skip = $('[data-otp-skip]');
    if (skip) skip.hidden = context !== 'signup';
    setOtpStatus(
      info && info.providersConfigured === false
        ? 'Codes are being recorded for review because email and SMS delivery is not configured yet. Nothing is stopping you from finishing here.'
        : 'Enter the 6-digit codes we sent. They expire in 10 minutes.'
    );
    otpPanel.hidden = false;
    const pending = OTP_PURPOSES.find((purpose) => !otpState[purpose].verified);
    if (pending) setTimeout(() => otpBoxes(pending)[0]?.focus(), 80);
  }

  function applyOtpVerification(info) {
    if (!info) return;
    state.verification = info;
    OTP_PURPOSES.forEach((purpose) => {
      const entry = otpState[purpose];
      if (!entry) return;
      const contact = purpose === 'email' ? info.email : info.phone;
      entry.verified = Boolean(contact?.verified);
      entry.destination = purpose === 'email' ? maskEmail(contact?.address) : maskPhone(contact?.number);
      entry.providers = typeof info.providersConfigured === 'boolean' ? info.providersConfigured : entry.providers;
      if (entry.verified) {
        entry.devCode = '';
        clearOtpInputs(purpose);
      }
      renderOtpChannel(purpose);
    });
  }

  function otpAllVerified() {
    return OTP_PURPOSES.every((purpose) => otpState[purpose]?.verified);
  }

  function closeOtp() {
    if (!otpPanel) return;
    otpPanel.hidden = true;
    OTP_PURPOSES.forEach((purpose) => stopCooldown(purpose));
    if (otpSlots.signup && otpPanel.parentElement !== otpSlots.signup) otpSlots.signup.appendChild(otpPanel);
  }

  async function requestOtp(purpose) {
    const entry = otpState[purpose];
    if (!entry) return;
    const button = $(`[data-otp-resend="${purpose}"]`);
    setOtpError(purpose, '');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      const result = await api('/api/auth/otp/request', { method: 'POST', json: { purpose } });
      entry.delivered = Boolean(result.delivered);
      entry.devCode = String(result.code || '');
      entry.error = result.error || '';
      entry.expiresInSeconds = result.expiresInSeconds || 600;
      entry.capReached = false;
      entry.capMessage = '';
      renderOtpChannel(purpose);
      startCooldown(purpose, result.resendAfterSeconds || OTP_RESEND_SECONDS);
      if (result.verification) applyOtpVerification(result.verification);
      // The server message repeats the full address (server.js:2811), so the UI
      // keeps its own masked line and only reports the delivery outcome.
      setOtpStatus(
        result.delivered
          ? `A fresh ${purpose === 'email' ? 'email' : 'mobile'} code is on its way to the address shown above.`
          : 'The code is recorded in the store outbox for review — email and SMS delivery is not configured yet.'
      );
    } catch (error) {
      const waiting = String(error.message).match(/wait (\d+) seconds/);
      if (waiting) startCooldown(purpose, Number(waiting[1]));
      if (/Too many codes requested/i.test(error.message)) {
        entry.capReached = true;
        entry.capMessage = error.message;
      } else {
        setOtpError(purpose, error.message);
      }
      refreshOtpHint(purpose);
    } finally {
      if (button && !entry.resendIn) {
        button.disabled = false;
        button.textContent = 'Send a new code';
      }
    }
  }

  OTP_PURPOSES.forEach((purpose) => {
    $(`[data-otp-verify="${purpose}"]`)?.addEventListener('click', async () => {
      const entry = otpState[purpose];
      if (!entry) return;
      const code = otpDigits(purpose);
      setOtpError(purpose, '');
      if (!/^\d{6}$/.test(code)) {
        setOtpError(purpose, 'Enter the 6-digit code we sent.');
        otpBoxes(purpose).find((box) => !box.value)?.focus();
        return;
      }
      const button = $(`[data-otp-verify="${purpose}"]`);
      if (button) {
        button.disabled = true;
        button.textContent = 'Checking…';
      }
      try {
        const result = await api('/api/auth/otp/verify', { method: 'POST', json: { purpose, code } });
        if (result.customer) state.customer = result.customer;
        entry.verified = true;
        entry.devCode = '';
        clearOtpInputs(purpose);
        if (result.verification) {
          applyOtpVerification(result.verification);
          renderVerification(result.verification);
        } else {
          renderOtpChannel(purpose);
        }
        setOtpStatus(result.message || 'Verified.');
        if (otpAllVerified()) {
          setOtpStatus('Both details verified — your account is fully unlocked.');
          toast('Your email and mobile are verified.');
          if (otpState.context === 'signup' && state.customer) {
            closeOtp();
            await showAccount(state.customer);
          }
        }
      } catch (error) {
        setOtpError(purpose, error.message);
        // An expired or exhausted code is consumed server-side (server.js:806
        // and 810), so the boxes are cleared and a new code must be requested.
        if (error.status === 410 || error.status === 429) {
          clearOtpInputs(purpose);
          otpBoxes(purpose)[0]?.focus();
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = purpose === 'email' ? 'Verify email' : 'Verify mobile';
        }
      }
    });

    $(`[data-otp-resend="${purpose}"]`)?.addEventListener('click', () => requestOtp(purpose));
  });

  $('[data-otp-skip]')?.addEventListener('click', async () => {
    const customer = state.customer;
    closeOtp();
    if (customer) await showAccount(customer);
  });

  $('[data-otp-close]')?.addEventListener('click', () => closeOtp());

  // ---------------------------------------------------------------- verification panel
  const STATUS_LABEL = { unverified: 'Not verified', pending: 'Pending review', approved: 'Verified', rejected: 'Action needed' };
  const DOC_LABEL = { pending: 'Awaiting review', accepted: 'Accepted', rejected: 'Not accepted' };
  const KIND_LABEL = { front: 'Front', back: 'Reverse' };

  const vels = {
    panel: $('[data-verification-panel]'),
    badge: $('[data-verify-badge]'),
    summary: $('[data-verify-summary]'),
    emailValue: $('[data-verify-email-value]'),
    emailState: $('[data-verify-email-state]'),
    emailSend: $('[data-verify-email-send]'),
    phoneValue: $('[data-verify-phone-value]'),
    phoneState: $('[data-verify-phone-state]'),
    phoneSend: $('[data-verify-phone-send]'),
    steps: $('[data-verify-steps]'),
    gateCheckout: $('[data-verify-gate-checkout]'),
    gateReseller: $('[data-verify-gate-reseller]'),
    note: $('[data-verify-note]'),
    docs: $('[data-verify-docs]'),
    docType: $('[data-verify-doc-type]'),
    docSubmit: $('[data-verify-doc-submit]'),
    docCancel: $('[data-verify-doc-cancel]'),
    docViewer: $('[data-verify-doc-viewer]'),
    docStatus: $('[data-verify-doc-status]'),
    avatarImg: $('[data-verify-avatar-img]'),
    avatarFallback: $('[data-verify-avatar-fallback]'),
    avatarBtn: $('[data-verify-avatar-btn]'),
    avatarInput: $('[data-verify-avatar-input]'),
    avatarName: $('[data-verify-avatar-name]'),
    avatarStatus: $('[data-verify-avatar-status]')
  };

  const docDraft = { front: null, back: null };
  let docViewUrl = '';
  let avatarViewUrl = '';

  function revokeDocView() {
    if (docViewUrl) {
      URL.revokeObjectURL(docViewUrl);
      docViewUrl = '';
    }
    if (vels.docViewer) {
      vels.docViewer.hidden = true;
      vels.docViewer.innerHTML = '';
    }
    if (vels.docCancel) vels.docCancel.hidden = true;
  }

  // Private files are pulled with the session cookie and shown from a blob URL,
  // so a stored filename never appears in markup or on screen.
  async function fetchPrivateBlob(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      let message = 'We could not reach the server for that file.';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        /* a non-JSON body keeps the fallback text */
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  async function viewDocument(id, declaredMime) {
    if (!vels.docViewer) return;
    revokeDocView();
    fieldError('[data-verify-doc-error]', '');
    try {
      const blob = await fetchPrivateBlob(`/api/account/verification/documents/${encodeURIComponent(id)}/view`);
      docViewUrl = URL.createObjectURL(blob);
      const type = blob.type || declaredMime || '';
      vels.docViewer.innerHTML = type.startsWith('image/')
        ? '<p class="field-hint">Private preview of your submitted document. It is available only while this page is open.</p>' +
          `<img class="doc-viewer__img" alt="Your submitted identity document" src="${esc(docViewUrl)}">`
        : '<p class="field-hint">Your document is stored as a PDF. Open it in a new tab — the address is private to this session.</p>' +
          `<a class="btn btn--ghost btn--small" href="${esc(docViewUrl)}" target="_blank" rel="noopener">Open document</a>`;
      vels.docViewer.hidden = false;
      if (vels.docCancel) vels.docCancel.hidden = false;
    } catch (error) {
      fieldError('[data-verify-doc-error]', error.message);
    }
  }

  function renderVerification(info) {
    if (!info || !vels.panel) return;
    state.verification = info;

    if (vels.badge) {
      vels.badge.textContent = STATUS_LABEL[info.status] || 'Not verified';
      vels.badge.className = `vstatus-badge vstatus-badge--${String(info.status || 'unverified')}`;
    }

    const lines = [];
    if (info.status === 'approved') lines.push('Your account is fully verified. Checkout and the reseller store are unlocked.');
    else if (info.status === 'pending') lines.push('We have your submission and an administrator is reviewing it. You can keep browsing meanwhile.');
    else if (info.status === 'rejected') lines.push('We could not approve your verification. The reason is below — correct it and submit again.');
    else lines.push('Not verified yet. Confirm your email and mobile with the codes we send to unlock checkout.');
    if (info.providersConfigured === false) lines.push(OTP_OUTBOX_NOTE);
    if (info.enforced === false) lines.push('This store is not enforcing verification yet, so your account can already check out.');
    if (vels.summary) vels.summary.textContent = lines.join(' ');

    if (vels.emailValue) vels.emailValue.textContent = maskEmail(info.email?.address);
    if (vels.phoneValue) vels.phoneValue.textContent = maskPhone(info.phone?.number);
    if (vels.emailState) {
      vels.emailState.textContent = info.email?.verified
        ? `Verified${info.email.verifiedAt ? ` ${dateFormat.format(new Date(info.email.verifiedAt))}` : ''}`
        : 'Not verified';
      vels.emailState.className = `vrow__state ${info.email?.verified ? 'is-yes' : 'is-no'}`;
    }
    if (vels.phoneState) {
      vels.phoneState.textContent = info.phone?.verified
        ? `Verified${info.phone.verifiedAt ? ` ${dateFormat.format(new Date(info.phone.verifiedAt))}` : ''}`
        : 'Not verified';
      vels.phoneState.className = `vrow__state ${info.phone?.verified ? 'is-yes' : 'is-no'}`;
    }
    if (vels.emailSend) vels.emailSend.hidden = Boolean(info.email?.verified);
    if (vels.phoneSend) vels.phoneSend.hidden = Boolean(info.phone?.verified);

    const steps = Array.isArray(info.nextSteps) ? info.nextSteps : [];
    if (vels.steps) vels.steps.innerHTML = steps.map((step) => `<li>${esc(step)}</li>`).join('');

    if (vels.gateCheckout) {
      vels.gateCheckout.textContent = info.canCheckout
        ? 'Checkout is unlocked for this account.'
        : 'Checkout is locked until both your email and mobile number are verified. Use a code below — documents are only needed for reseller access.';
      vels.gateCheckout.className = `vgate ${info.canCheckout ? 'vgate--ok' : 'vgate--blocked'}`;
    }
    if (vels.gateReseller) {
      vels.gateReseller.textContent = info.canReseller
        ? 'The reseller store is unlocked — you can stock and sell.'
        : info.mode === 'otp+documents'
          ? 'The reseller store needs verified contact details and an accepted document pair. Codes alone are enough for retail checkout.'
          : 'The reseller store needs your email and mobile verified by code.';
      vels.gateReseller.className = `vgate ${info.canReseller ? 'vgate--ok' : 'vgate--blocked'}`;
    }

    // The store panel mirrors the same server decision (server.js:2972), so it
    // never sits there looking clickable while the API is refusing writes.
    setText(
      '[data-store-gate]',
      info.canReseller
        ? ''
        : info.mode === 'otp+documents'
          ? 'Stocking your store stays locked until your email and mobile are verified by code and an administrator accepts your document pair.'
          : 'Stocking your store stays locked until your email and mobile are verified by code.'
    );
    const storeGate = $('[data-store-gate]');
    if (storeGate) storeGate.hidden = Boolean(info.canReseller);

    if (vels.note) {
      const reason = String(info.note || '');
      if (info.status === 'rejected') {
        vels.note.hidden = false;
        vels.note.textContent = `Reviewer note: ${reason || 'the documents were not readable. Upload a clearer copy of both sides.'}`;
      } else {
        vels.note.hidden = true;
        vels.note.textContent = '';
      }
    }

    const docs = Array.isArray(info.documents) ? info.documents : [];
    if (vels.docs) {
      if (!docs.length) {
        vels.docs.innerHTML = '<p class="field-hint">No identity documents on file. A pair is only needed for wholesale or reseller access.</p>';
      } else {
        vels.docs.innerHTML = docs
          .map((doc) => {
            const size = Number(doc.bytes) ? ` · ${Math.round(Number(doc.bytes) / 1024)} KB` : '';
            const dated = doc.createdAt ? dateFormat.format(new Date(doc.createdAt)) : '';
            return `<div class="vdoc">
              <span class="vdoc__name">${esc(KIND_LABEL[doc.kind] || doc.kind || 'Side')} · ${esc(doc.docType || '')}</span>
              <span class="vdoc__state vdoc__state--${esc(String(doc.status || 'pending'))}">${esc(DOC_LABEL[doc.status] || doc.status || 'Awaiting review')}</span>
              <span class="vdoc__meta">${esc(`${dated}${size}`)}</span>
              ${doc.note ? `<span class="vdoc__note">${esc(doc.note)}</span>` : ''}
              <span class="vdoc__actions">
                <button class="btn btn--ghost btn--small" type="button" data-doc-view="${esc(doc.id)}" data-doc-mime="${esc(doc.mime || '')}">View</button>
                ${doc.status === 'pending' ? `<button class="btn btn--ghost btn--small" type="button" data-doc-withdraw="${esc(doc.id)}">Withdraw</button>` : ''}
              </span>
            </div>`;
          })
          .join('');
        revokeDocView();
      }
    }

    // Keep the type list in step with what the administrator accepts.
    const accepted = Array.isArray(info.acceptedDocTypes) && info.acceptedDocTypes.length ? info.acceptedDocTypes : DOC_TYPES;
    if (vels.docType) {
      const current = vels.docType.value;
      vels.docType.innerHTML =
        '<option value="">Select a type</option>' +
        accepted.map((type) => `<option value="${esc(type)}">${esc(String(type).replace(/-/g, ' '))}</option>`).join('');
      if (accepted.includes(current)) vels.docType.value = current;
    }

    if (vels.avatarBtn) vels.avatarBtn.textContent = state.customer?.hasAvatar ? 'Replace picture' : 'Choose picture';
    applyOtpVerification(info);
  }

  async function loadVerification() {
    if (!vels.panel) return;
    try {
      const data = await api('/api/account/verification');
      renderVerification(data.verification);
    } catch (error) {
      if (vels.summary) {
        vels.summary.textContent = error.status === 401 ? 'Please sign in to see your verification status.' : error.message;
      }
    }
  }

  function clearDocDraft() {
    docDraft.front = null;
    docDraft.back = null;
    if (vels.docType) vels.docType.value = '';
    const frontInput = $('[data-verify-doc-front-input]');
    const backInput = $('[data-verify-doc-back-input]');
    if (frontInput) frontInput.value = '';
    if (backInput) backInput.value = '';
    setText('[data-verify-doc-front-name]', 'No file chosen');
    setText('[data-verify-doc-back-name]', 'No file chosen');
  }

  async function uploadDocuments() {
    fieldError('[data-verify-doc-error]', '');
    if (vels.docStatus) vels.docStatus.textContent = '';
    const docType = String(vels.docType?.value || '');
    if (!docType) {
      fieldError('[data-verify-doc-error]', 'Choose the document type first.');
      vels.docType?.focus();
      return;
    }
    if (!docDraft.front || !docDraft.back) {
      fieldError('[data-verify-doc-error]', 'Upload both the front and the reverse — they are reviewed as one pair.');
      return;
    }
    const problem = checkDocFile(docDraft.front, 'Front') || checkDocFile(docDraft.back, 'Reverse');
    if (problem) {
      fieldError('[data-verify-doc-error]', problem);
      return;
    }
    if (vels.docSubmit) {
      vels.docSubmit.disabled = true;
      vels.docSubmit.textContent = 'Uploading…';
    }
    try {
      const result = await api('/api/account/verification/documents', {
        method: 'POST',
        json: {
          docType,
          front: await readFileDataUrl(docDraft.front),
          back: await readFileDataUrl(docDraft.back)
        }
      });
      if (vels.docStatus) vels.docStatus.textContent = result.message || 'Documents received.';
      clearDocDraft();
      revokeDocView();
      renderVerification(result.verification);
      toast(result.message || 'Documents sent for review.');
    } catch (error) {
      fieldError('[data-verify-doc-error]', error.message);
    } finally {
      if (vels.docSubmit) {
        vels.docSubmit.disabled = false;
        vels.docSubmit.textContent = 'Upload pair';
      }
    }
  }

  async function withdrawDocument(id) {
    fieldError('[data-verify-doc-error]', '');
    try {
      const result = await api(`/api/account/verification/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (docViewUrl) revokeDocView();
      renderVerification(result.verification);
      if (vels.docStatus) vels.docStatus.textContent = result.message || 'Document withdrawn.';
    } catch (error) {
      // Only a pending side can be withdrawn (server.js:2864); the server says
      // so, and the message is shown instead of hiding the failure.
      fieldError('[data-verify-doc-error]', error.message);
    }
  }

  async function loadAvatar() {
    if (!vels.avatarImg) return;
    if (avatarViewUrl) {
      URL.revokeObjectURL(avatarViewUrl);
      avatarViewUrl = '';
    }
    const hide = () => {
      vels.avatarImg.hidden = true;
      vels.avatarImg.removeAttribute('src');
      if (vels.avatarFallback) vels.avatarFallback.hidden = false;
      if (vels.avatarBtn) vels.avatarBtn.textContent = 'Choose picture';
    };
    if (!state.customer?.hasAvatar) {
      hide();
      return;
    }
    try {
      const blob = await fetchPrivateBlob('/api/account/avatar');
      avatarViewUrl = URL.createObjectURL(blob);
      vels.avatarImg.src = avatarViewUrl;
      vels.avatarImg.hidden = false;
      if (vels.avatarFallback) vels.avatarFallback.hidden = true;
      if (vels.avatarBtn) vels.avatarBtn.textContent = 'Replace picture';
    } catch (error) {
      hide();
      if (error.status !== 404 && vels.avatarStatus) {
        vels.avatarStatus.textContent = `${error.message} Your picture stays private to this account.`;
      }
    }
  }

  function bindVerificationPanel() {
    $('[data-verify-refresh]')?.addEventListener('click', async () => {
      await loadVerification();
      await loadAvatar();
      toast('Status re-checked.');
    });

    $('[data-verify-support]')?.addEventListener('click', () => {
      if (window.VELUNEChat?.open) {
        window.VELUNEChat.open('My account verification is blocking me — please advise.', '');
        return;
      }
      window.location.href = '/contact';
    });

    vels.emailSend?.addEventListener('click', () => {
      openOtp('account', { verification: state.verification || undefined });
      requestOtp('email');
    });
    vels.phoneSend?.addEventListener('click', () => {
      openOtp('account', { verification: state.verification || undefined });
      requestOtp('phone');
    });

    $('[data-verify-doc-front-btn]')?.addEventListener('click', () => $('[data-verify-doc-front-input]')?.click());
    $('[data-verify-doc-back-btn]')?.addEventListener('click', () => $('[data-verify-doc-back-input]')?.click());
    $('[data-verify-doc-front-input]')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0] || null;
      event.target.value = '';
      const problem = file ? checkDocFile(file, 'Front') : '';
      docDraft.front = problem ? null : file;
      fieldError('[data-verify-doc-error]', problem);
      setText('[data-verify-doc-front-name]', docDraft.front ? `${file.name} · ${Math.round(file.size / 1024)} KB` : 'No file chosen');
    });
    $('[data-verify-doc-back-input]')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0] || null;
      event.target.value = '';
      const problem = file ? checkDocFile(file, 'Reverse') : '';
      docDraft.back = problem ? null : file;
      fieldError('[data-verify-doc-error]', problem);
      setText('[data-verify-doc-back-name]', docDraft.back ? `${file.name} · ${Math.round(file.size / 1024)} KB` : 'No file chosen');
    });

    vels.docSubmit?.addEventListener('click', uploadDocuments);
    vels.docCancel?.addEventListener('click', revokeDocView);

    vels.docs?.addEventListener('click', (event) => {
      const view = event.target.closest('[data-doc-view]');
      if (view) {
        viewDocument(view.dataset.docView, view.dataset.docMime || '');
        return;
      }
      const withdraw = event.target.closest('[data-doc-withdraw]');
      if (withdraw) withdrawDocument(withdraw.dataset.docWithdraw);
    });

    vels.avatarBtn?.addEventListener('click', () => vels.avatarInput?.click());
    vels.avatarInput?.addEventListener('change', async () => {
      const file = vels.avatarInput.files?.[0] || null;
      vels.avatarInput.value = '';
      fieldError('[data-verify-avatar-error]', '');
      if (vels.avatarStatus) vels.avatarStatus.textContent = '';
      if (!file) {
        if (vels.avatarName) vels.avatarName.textContent = 'No new file selected';
        return;
      }
      const problem = checkImageFile(file, { minBytes: MIN_AVATAR_BYTES, label: 'Profile picture' });
      if (problem) {
        fieldError('[data-verify-avatar-error]', problem);
        if (vels.avatarName) vels.avatarName.textContent = 'No new file selected';
        return;
      }
      if (vels.avatarName) vels.avatarName.textContent = `Uploading ${file.name}…`;
      if (vels.avatarBtn) vels.avatarBtn.disabled = true;
      try {
        const result = await api('/api/account/avatar', {
          method: 'POST',
          json: { profilePicture: await readFileDataUrl(file) }
        });
        if (result.customer) state.customer = result.customer;
        if (vels.avatarStatus) vels.avatarStatus.textContent = result.message || 'Profile picture updated.';
        if (vels.avatarName) vels.avatarName.textContent = file.name;
        await loadAvatar();
      } catch (error) {
        fieldError('[data-verify-avatar-error]', error.message);
        if (vels.avatarName) vels.avatarName.textContent = 'No new file selected';
      } finally {
        if (vels.avatarBtn) vels.avatarBtn.disabled = false;
      }
    });
  }

  bindVerificationPanel();

  els.profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError('[data-profile-error]', '');
    const status = $('[data-profile-status]');
    if (status) status.textContent = '';
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = $('[data-profile-save]', form);
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const result = await api('/api/account', {
        method: 'PATCH',
        json: {
          firstName: String(data.get('firstName') || '').trim(),
          lastName: String(data.get('lastName') || '').trim(),
          phone: String(data.get('phone') || '').trim(),
          marketingOptIn: data.get('marketingOptIn') === 'on'
        }
      });
      state.customer = result.customer;
      fillProfile(result.customer);
      if (status) status.textContent = result.message || 'Profile updated.';
      toast('Your details were saved.');
    } catch (error) {
      fieldError('[data-profile-error]', error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Save details';
      }
    }
  });

  els.passwordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError('[data-password-error]', '');
    const status = $('[data-password-status]');
    if (status) status.textContent = '';
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = $('[data-password-save]', form);
    if (button) {
      button.disabled = true;
      button.textContent = 'Updating…';
    }
    try {
      const result = await api('/api/account/password', {
        method: 'POST',
        json: {
          currentPassword: String(data.get('currentPassword') || ''),
          newPassword: String(data.get('newPassword') || '')
        }
      });
      form.reset();
      if (result.token) setCustomerToken(result.token);
      if (status) status.textContent = result.message || 'Password updated.';
      toast('Password updated.');
    } catch (error) {
      fieldError('[data-password-error]', error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Update password';
      }
    }
  });

  $('[data-logout]')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', json: {} });
    } catch {
      /* Clearing the local view is still the right outcome. */
    }
    state.customer = null;
    state.orders = [];
    state.verification = null;
    setCustomerToken('');
    closeOtp();
    clearDocDraft();
    revokeDocView();
    if (avatarViewUrl) {
      URL.revokeObjectURL(avatarViewUrl);
      avatarViewUrl = '';
    }
    if (els.accountDot) els.accountDot.hidden = true;
    if (window.location.pathname !== '/account') window.history.replaceState({}, '', '/account');
    showAuth('login');
    toast('Signed out.');
  });

  (async () => {
    try {
      const data = await api('/api/auth/session');
      if (data.customer) {
        await showAccount(data.customer);
      } else {
        setCustomerToken('');
        showAuth(window.location.pathname === '/register' ? 'register' : 'login');
      }
    } catch (error) {
      if (error && error.status === 401) setCustomerToken('');
      showAuth('login');
      fieldError('[data-auth-error]', error && error.status ? error.message : 'We could not reach the server. Check that it is running.');
    }
  })();
})();

/* ============================================================
   RESELLER STORE
   ============================================================ */
(() => {
  'use strict';

  const { $, $$, api, esc, money, toast } = window.VELUNE;

  const storeAddForm    = $('[data-store-add-form]');
  const storeAddBtn     = $('[data-store-add-btn]');
  const storeAddError   = $('[data-store-add-error]');
  const storeAddStatus  = $('[data-store-add-status]');
  const storeInventory  = $('[data-store-inventory]');
  const storeSellForm   = $('[data-store-sell-form]');
  const storeSellBtn    = $('[data-store-sell-btn]');
  const storeSellError  = $('[data-store-sell-error]');
  const storeSellStatus = $('[data-store-sell-status]');
  const storeOrders     = $('[data-store-orders]');
  const productSelect   = $('[data-store-product-select]');
  const sellAddItem     = $('[data-sell-add-item]');
  const sellItemsList   = $('[data-sell-items-list]');
  const sellStateSelect = $('[data-sell-state-select]');
  const profileForm     = $('[data-store-profile-form]');
  const profileSave     = $('[data-store-profile-save]');
  const profileError    = $('[data-store-profile-error]');
  const profileStatus   = $('[data-store-profile-status]');
  const submitBtn       = $('[data-store-submit-btn]');
  const statusBadge     = $('[data-store-status]');
  const reviewNote      = $('[data-store-review-note]');
  const publicRow       = $('[data-store-public]');
  const publicLink      = $('[data-store-public-link]');
  const slugPreview     = $('[data-store-slug-preview]');
  const inventoryError  = $('[data-store-inventory-error]');

  let catalog = [];
  let inventory = [];
  let storeRecord = null;
  let canReseller = false;

  // Only run if the store section exists on the page
  if (!storeInventory) return;

  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // requireFeature() answers 403 with the reason (server.js:683-690), so the UI
  // names the blocker and links to the status panel instead of a dead button.
  function restrictedNode(err, node) {
    if (!node) return;
    node.textContent = err?.message || 'Verification is needed before you can use the store.';
    if (err?.status !== 403) return;
    node.appendChild(document.createTextNode(' '));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn';
    link.textContent = 'Open your verification status';
    link.addEventListener('click', () => {
      const panel = document.querySelector('[data-verification-panel]');
      if (!panel) return;
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
    node.appendChild(link);
  }

  // ---- Fill product dropdown ----
  async function loadCatalog() {
    try {
      const data = await api('/api/products');
      catalog = (data.products || []).filter(p => p.stock > 0);
      if (productSelect) {
        productSelect.innerHTML =
          '<option value="">Select a product\u2026</option>' +
          catalog.map(p => `<option value="${esc(p.slug)}">${esc(p.name)} (${p.stock} in stock, ${money(p.price)})</option>`).join('');
      }
    } catch { /* silent */ }
  }

  // ---- Fill US states for sell form ----
  async function loadStates() {
    try {
      const data = await api('/api/shipping');
      if (sellStateSelect && Array.isArray(data.states)) {
        sellStateSelect.innerHTML =
          '<option value="">Select state</option>' +
          data.states.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      }
    } catch { /* silent */ }
  }

  // ---- Store profile and review state ----
  const STORE_LABELS = {
    draft: 'Draft',
    pending: 'In review',
    approved: 'Approved',
    rejected: 'Changes needed',
    suspended: 'Suspended'
  };

  function slugify(value) {
    return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function fillProfile() {
    if (!profileForm || profileForm.dataset.touched === 'true') return;
    profileForm.elements.name.value = storeRecord?.name || '';
    profileForm.elements.slug.value = storeRecord?.slug || '';
    profileForm.elements.tagline.value = storeRecord?.tagline || '';
    profileForm.elements.about.value = storeRecord?.about || '';
    profileForm.elements.contactEmail.value = storeRecord?.contactEmail || '';
    if (slugPreview) slugPreview.textContent = storeRecord?.slug || 'your-store';
  }

  function renderProfile() {
    const status = storeRecord?.status || null;
    if (statusBadge) {
      statusBadge.textContent = STORE_LABELS[status] || 'Not created';
      statusBadge.className = `store-status store-status--${status || 'none'}`;
    }
    if (reviewNote) {
      const note = storeRecord?.reviewNote || '';
      const show = Boolean(note) && ['rejected', 'suspended'].includes(status);
      reviewNote.hidden = !show;
      reviewNote.textContent = show ? `Reviewer note: ${note}` : '';
    }
    if (publicRow && publicLink) {
      const live = Boolean(storeRecord?.live && storeRecord?.slug);
      publicRow.hidden = !live;
      if (live) {
        publicLink.href = `/store/${encodeURIComponent(storeRecord.slug)}`;
        publicLink.textContent = `/store/${storeRecord.slug}`;
      }
    }
    if (submitBtn) {
      submitBtn.disabled = ['pending', 'approved', 'suspended'].includes(status);
      submitBtn.textContent = status === 'pending'
        ? 'Review in progress'
        : status === 'approved'
          ? 'Store approved'
          : status === 'suspended'
            ? 'Store suspended'
            : 'Submit for review';
    }
    fillProfile();
  }

  function applyStorePayload(data) {
    if (!data) return;
    inventory = data.inventory || [];
    storeRecord = data.store || null;
    canReseller = Boolean(data.canReseller);
    renderProfile();
    renderInventory();
  }

  // ---- Render inventory table ----
  function renderInventory() {
    if (!storeInventory) return;
    if (!inventory.length) {
      storeInventory.innerHTML = '<p class="field-hint">Your store is empty. Add products above to get started.</p>';
      return;
    }
    const approved = storeRecord?.status === 'approved';
    storeInventory.innerHTML = `<table class="store-table store-table--manage">
      <thead><tr><th>Product</th><th>Units</th><th>Your price</th><th>Published</th><th></th></tr></thead>
      <tbody>
        ${inventory.map(entry => {
          const base = entry.product ? entry.product.price : 0;
          const price = Number.isFinite(entry.price) && entry.price > 0 ? entry.price : base;
          return `<tr data-inventory-row="${esc(entry.slug)}">
            <td>${esc(entry.product ? entry.product.name : entry.slug)}</td>
            <td>${entry.qty}</td>
            <td><input class="store-price-input" type="number" min="${base}" max="100000" step="0.01" value="${price}" data-item-price aria-label="Selling price for ${esc(entry.product ? entry.product.name : entry.slug)}"></td>
            <td><label class="store-publish"><input type="checkbox" data-item-publish${entry.published ? ' checked' : ''}${!approved && !entry.published ? ' disabled' : ''}> <span>${entry.published ? 'Live' : approved ? 'Off' : 'After approval'}</span></label></td>
            <td class="store-row-actions">
              <button type="button" class="btn btn--ghost btn--small" data-item-save>Save</button>
              <button type="button" class="btn btn--ghost btn--small store-remove" data-item-remove>Remove</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${approved ? '' : '<p class="field-hint">Publishing unlocks once an administrator approves your store.</p>'}`;

    // Also refresh the sell items dropdowns
    refreshSellItemSelects();
  }

  // ---- Load inventory and store profile from server ----
  async function loadInventory() {
    try {
      const data = await api('/api/account/store');
      applyStorePayload(data);
    } catch (err) {
      if (storeInventory) storeInventory.innerHTML = `<p class="field-hint" style="color:var(--danger)">${esc(err.message)}</p>`;
    }
  }

  if (profileForm) {
    profileForm.addEventListener('input', () => {
      profileForm.dataset.touched = 'true';
      if (slugPreview) slugPreview.textContent = slugify(profileForm.elements.slug.value) || 'your-store';
    });
    profileForm.elements.name?.addEventListener('input', () => {
      if (!profileForm.elements.slug.value) {
        profileForm.elements.slug.value = slugify(profileForm.elements.name.value);
        if (slugPreview) slugPreview.textContent = profileForm.elements.slug.value || 'your-store';
      }
    });
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (profileError) profileError.textContent = '';
      if (profileStatus) profileStatus.textContent = '';
      const data = new FormData(profileForm);
      const payload = {
        name: String(data.get('name') || '').trim(),
        slug: String(data.get('slug') || '').trim(),
        tagline: String(data.get('tagline') || '').trim(),
        about: String(data.get('about') || '').trim(),
        contactEmail: String(data.get('contactEmail') || '').trim()
      };
      if (profileSave) { profileSave.disabled = true; profileSave.textContent = 'Saving…'; }
      try {
        const result = await api('/api/account/store', { method: 'POST', json: payload });
        if (profileStatus) profileStatus.textContent = result.message || 'Store saved.';
        profileForm.dataset.touched = '';
        await loadInventory();
      } catch (err) {
        restrictedNode(err, profileError);
      } finally {
        if (profileSave) { profileSave.disabled = false; profileSave.textContent = 'Save store details'; }
      }
    });
  }

  submitBtn?.addEventListener('click', async () => {
    if (profileError) profileError.textContent = '';
    if (profileStatus) profileStatus.textContent = '';
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Submitting…';
    try {
      const result = await api('/api/account/store/submit', { method: 'POST', json: {} });
      if (profileStatus) profileStatus.textContent = result.message || 'Store submitted for review.';
      toast(result.message || 'Store submitted for review.');
      await loadInventory();
    } catch (err) {
      restrictedNode(err, profileError);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  // ---- Inventory price, publish and remove controls ----
  storeInventory?.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-inventory-row]');
    if (!row) return;
    const slug = row.dataset.inventoryRow;
    if (inventoryError) inventoryError.textContent = '';
    const save = event.target.closest('[data-item-save]');
    const remove = event.target.closest('[data-item-remove]');
    if (save) {
      const price = Number(row.querySelector('[data-item-price]')?.value);
      if (!Number.isFinite(price) || price <= 0) {
        if (inventoryError) inventoryError.textContent = 'Enter a valid selling price.';
        return;
      }
      save.disabled = true;
      try {
        const result = await api(`/api/account/store/items/${encodeURIComponent(slug)}`, { method: 'PATCH', json: { price } });
        toast(result.message || 'Price saved.');
        await loadInventory();
      } catch (err) {
        restrictedNode(err, inventoryError);
        save.disabled = false;
      }
      return;
    }
    if (remove) {
      const name = row.querySelector('td')?.textContent?.trim() || 'this product';
      if (!window.confirm(`Remove ${name} from your store? Unsold units return to the catalogue.`)) return;
      remove.disabled = true;
      try {
        const result = await api(`/api/account/store/items/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        toast(result.message || 'Removed from your store.');
        await loadInventory();
        await loadCatalog();
      } catch (err) {
        restrictedNode(err, inventoryError);
        remove.disabled = false;
      }
    }
  });

  storeInventory?.addEventListener('change', async (event) => {
    const toggle = event.target.closest('[data-item-publish]');
    if (!toggle) return;
    const row = toggle.closest('[data-inventory-row]');
    if (!row) return;
    if (inventoryError) inventoryError.textContent = '';
    toggle.disabled = true;
    try {
      const result = await api(`/api/account/store/items/${encodeURIComponent(row.dataset.inventoryRow)}`, {
        method: 'PATCH',
        json: { published: toggle.checked }
      });
      toast(result.message || 'Store updated.');
      await loadInventory();
    } catch (err) {
      restrictedNode(err, inventoryError);
      toggle.checked = !toggle.checked;
      toggle.disabled = false;
    }
  });

  // ---- Sell form: dynamic item rows ----
  function makeItemRow() {
    const row = document.createElement('div');
    row.className = 'field-row store-sell-item';
    row.innerHTML = `
      <div class="field" style="flex:2;">
        <label>Product from your store</label>
        <select name="sell_slug" required>
          <option value="">Select\u2026</option>
          ${inventory.map(e => `<option value="${esc(e.slug)}">${esc(e.product ? e.product.name : e.slug)} (${e.qty} available)</option>`).join('')}
        </select>
      </div>
      <div class="field" style="flex:0 0 80px;">
        <label>Qty</label>
        <input type="number" name="sell_qty" min="1" max="99" value="1" required>
      </div>
      <div class="field" style="flex:0 0 auto;display:flex;align-items:flex-end;">
        <button type="button" class="btn btn--ghost btn--small store-sell-remove" aria-label="Remove item">\u00d7</button>
      </div>`;
    row.querySelector('.store-sell-remove').addEventListener('click', () => row.remove());
    return row;
  }

  function refreshSellItemSelects() {
    if (!sellItemsList) return;
    // Update existing selects with fresh inventory options
    sellItemsList.querySelectorAll('select[name="sell_slug"]').forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = '<option value="">Select\u2026</option>' +
        inventory.map(e => `<option value="${esc(e.slug)}"${e.slug === currentVal ? ' selected' : ''}>${esc(e.product ? e.product.name : e.slug)} (${e.qty} available)</option>`).join('');
    });
  }

  sellAddItem?.addEventListener('click', () => {
    if (!sellItemsList) return;
    sellItemsList.appendChild(makeItemRow());
  });

  // ---- Add to store form submit ----
  storeAddForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (storeAddError) storeAddError.textContent = '';
    if (storeAddStatus) storeAddStatus.textContent = '';
    const form = event.currentTarget;
    const data = new FormData(form);
    const slug = String(data.get('slug') || '').trim();
    const qty = Number(data.get('qty') || 1);
    const rawPrice = String(data.get('price') || '').trim();
    if (!slug) { if (storeAddError) storeAddError.textContent = 'Select a product.'; return; }
    if (storeAddBtn) { storeAddBtn.disabled = true; storeAddBtn.textContent = 'Adding\u2026'; }
    try {
      const payload = { slug, qty };
      if (rawPrice) payload.price = Number(rawPrice);
      const result = await api('/api/account/store/add', { method: 'POST', json: payload });
      applyStorePayload({ inventory: result.inventory, store: storeRecord, canReseller });
      if (storeAddStatus) storeAddStatus.textContent = result.message || 'Added to your store.';
      toast(result.message || 'Added to your store.');
      form.reset();
      // Refresh catalog stock
      await loadCatalog();
    } catch (err) {
      restrictedNode(err, storeAddError);
    } finally {
      if (storeAddBtn) { storeAddBtn.disabled = false; storeAddBtn.textContent = 'Add to store'; }
    }
  });

  // ---- Place order for buyer form submit ----
  storeSellForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (storeSellError) storeSellError.textContent = '';
    if (storeSellStatus) storeSellStatus.textContent = '';
    const form = event.currentTarget;

    const rows = form.querySelectorAll('.store-sell-item');
    const items = [];
    let valid = true;
    rows.forEach(row => {
      const slug = String(row.querySelector('[name="sell_slug"]')?.value || '').trim();
      const qty = Number(row.querySelector('[name="sell_qty"]')?.value || 0);
      if (!slug || qty < 1) { valid = false; return; }
      items.push({ slug, qty });
    });
    if (!valid || !items.length) {
      if (storeSellError) storeSellError.textContent = 'Add at least one item from your store.';
      return;
    }

    const fdata = new FormData(form);
    const payload = {
      customer: {
        firstName: String(fdata.get('firstName') || '').trim(),
        lastName: String(fdata.get('lastName') || '').trim(),
        email: String(fdata.get('email') || '').trim(),
        phone: String(fdata.get('phone') || '').trim(),
      },
      shipping: {
        address1: String(fdata.get('address1') || '').trim(),
        address2: '',
        city: String(fdata.get('city') || '').trim(),
        state: String(fdata.get('state') || '').trim(),
        zip: String(fdata.get('zip') || '').trim(),
        country: 'US'
      },
      items,
      shippingMethod: String(fdata.get('shippingMethod') || 'standard'),
      notes: '',
      idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sk-${Date.now()}`
    };

    if (storeSellBtn) { storeSellBtn.disabled = true; storeSellBtn.textContent = 'Placing order\u2026'; }
    try {
      const result = await api('/api/account/store/sell', { method: 'POST', json: payload });
      if (storeSellStatus) storeSellStatus.textContent = `Order ${result.order.number} placed for buyer.`;
      toast(`Order ${result.order.number} placed.`);
      form.reset();
      if (sellItemsList) sellItemsList.innerHTML = '';
      await loadInventory();
      await loadStoreOrders();
    } catch (err) {
      restrictedNode(err, storeSellError);
    } finally {
      if (storeSellBtn) { storeSellBtn.disabled = false; storeSellBtn.textContent = 'Place order for buyer'; }
    }
  });

  // ---- Load store orders ----
  async function loadStoreOrders() {
    if (!storeOrders) return;
    try {
      const data = await api('/api/account/store/orders');
      const orders = data.orders || [];
      if (!orders.length) {
        storeOrders.innerHTML = '<p class="field-hint">No orders placed through your store yet.</p>';
        return;
      }
      storeOrders.innerHTML = orders.map(order => {
        const href = `/order?number=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.token)}`;
        const paidClass = order.paymentStatus === 'Paid' ? 'store-order__pay--paid' : 'store-order__pay--pending';
        return `<div class="store-order">
          <div class="store-order__head">
            <a href="${href}" class="account-order__number">${esc(order.number)}</a>
            <span>${esc(dateFormat.format(new Date(order.createdAt)))}</span>
            <span class="order-status order-status--${esc(String(order.status||'').toLowerCase().replace(/[^a-z]/g,''))}">${esc(order.status)}</span>
            <span class="store-order__pay ${paidClass}">${esc(order.paymentStatus || 'Awaiting Payment')}</span>
          </div>
          <div class="store-order__body">
            <span>${esc(order.customer.firstName)} ${esc(order.customer.lastName)} &mdash; ${esc(order.customer.email)}</span>
            <strong>${money(order.total)}</strong>
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      if (storeOrders) storeOrders.innerHTML = `<p class="field-hint" style="color:var(--danger)">${esc(err.message)}</p>`;
    }
  }

  // ---- Init: load everything when account view is active ----
  // Watch for the account view becoming visible (account.js shows it after session check)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
        const target = mutation.target;
        if (target.dataset && target.dataset.accountView !== undefined && !target.hidden) {
          observer.disconnect();
          loadCatalog();
          loadStates();
          loadInventory();
          loadStoreOrders();
        }
      }
    }
  });
  const accountView = $('[data-account-view]');
  if (accountView) {
    observer.observe(accountView, { attributes: true });
    // If already visible on load
    if (!accountView.hidden) {
      loadCatalog();
      loadStates();
      loadInventory();
      loadStoreOrders();
    }
  }
})();
