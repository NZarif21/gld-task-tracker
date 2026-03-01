const slots = [0, 1, 2, 3];
const POLL_MS = 15000;
const TICK_MS = 500;
const CACHE_KEY = "gld_task_tracker_cache_v1";
const MUTATION_QUEUE_KEY = "gld_task_tracker_mutation_queue_v1";
const THEME_KEY = "gld_task_tracker_theme_v1";

const appState = {
  jobs: [],
  selectedJobId: null,
  selectedDate: todayIsoDateLocal(),
  tasks: [],
  taskCacheByJob: {},
  timerHandle: null,
  pollHandle: null,
  supabase: null,
  isOnline: navigator.onLine,
  mutationQueue: [],
  syncInFlight: false,
  theme: "light",
};

function todayIsoDateLocal() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, "0")).join(":");
}

function loadCachedState() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    appState.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    appState.selectedJobId = parsed.selectedJobId || null;
    appState.selectedDate = parsed.selectedDate || todayIsoDateLocal();
    appState.taskCacheByJob = parsed.taskCacheByJob || {};
    appState.tasks = appState.selectedJobId
      ? appState.taskCacheByJob[appState.selectedJobId] || []
      : [];
  } catch (error) {
    console.error("Failed loading cache:", error);
  }
}

function persistCachedState() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        jobs: appState.jobs,
        selectedJobId: appState.selectedJobId,
        selectedDate: appState.selectedDate,
        taskCacheByJob: appState.taskCacheByJob,
      })
    );
  } catch (error) {
    console.error("Failed writing cache:", error);
  }
}

function loadMutationQueue() {
  try {
    const raw = localStorage.getItem(MUTATION_QUEUE_KEY);
    appState.mutationQueue = raw ? JSON.parse(raw) : [];
  } catch (error) {
    appState.mutationQueue = [];
  }
}

function persistMutationQueue() {
  localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(appState.mutationQueue));
}

function loadThemePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    appState.theme = stored;
    return;
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  appState.theme = prefersDark ? "dark" : "light";
}

function persistThemePreference() {
  localStorage.setItem(THEME_KEY, appState.theme);
}

function applyTheme() {
  document.body.classList.toggle("theme-dark", appState.theme === "dark");

  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) {
    return;
  }

  const showingDark = appState.theme === "dark";
  themeToggle.textContent = showingDark ? "Light Mode" : "Dark Mode";
  themeToggle.setAttribute("aria-label", showingDark ? "Switch to light mode" : "Switch to dark mode");
}

function toggleTheme() {
  appState.theme = appState.theme === "dark" ? "light" : "dark";
  persistThemePreference();
  applyTheme();
}

function calculateElapsed(task) {
  if (task.status !== "running" || !task.started_at) {
    return Number(task.elapsed_ms || 0);
  }
  return Number(task.elapsed_ms || 0) + (Date.now() - new Date(task.started_at).getTime());
}

function getQueuedTasks() {
  return appState.tasks.filter((task) => task.status === "queued");
}

function getRunningTasksOrdered() {
  return appState.tasks
    .filter((task) => task.status === "running" || task.status === "paused")
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return String(a.id).localeCompare(String(b.id));
    });
}

function enqueueMutation(mutation) {
  appState.mutationQueue.push(mutation);
  persistMutationQueue();
}

function setConnectionPill() {
  const el = document.getElementById("connection-state");
  if (!el) {
    return;
  }
  const online = appState.isOnline;
  el.textContent = online ? "Online" : "Offline";
  el.classList.remove("online", "offline");
  el.classList.add(online ? "online" : "offline");
}

function getConfig() {
  return window.APP_CONFIG || {};
}

function hasSupabaseConfig() {
  const config = getConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function updateTaskLocal(taskId, patch) {
  const task = appState.tasks.find((item) => item.id === taskId);
  if (!task) {
    return null;
  }
  Object.assign(task, patch);
  appState.taskCacheByJob[appState.selectedJobId] = appState.tasks;
  persistCachedState();
  return task;
}

function refillActiveSlots() {
  const activeCount = appState.tasks.filter(
    (task) => task.status === "running" || task.status === "paused"
  ).length;
  const needed = Math.max(0, 4 - activeCount);
  if (needed === 0) {
    return [];
  }

  const queued = getQueuedTasks().slice(0, needed);
  const patchTime = new Date().toISOString();
  const mutations = [];

  for (const task of queued) {
    task.status = "paused";
    task.updated_at = patchTime;
    mutations.push({
      type: "task_update",
      taskId: task.id,
      patch: { status: "paused", updated_at: patchTime },
      eventType: "auto_promote",
    });
  }

  appState.taskCacheByJob[appState.selectedJobId] = appState.tasks;
  persistCachedState();
  return mutations;
}

async function applyMutationRemote(mutation) {
  if (!appState.supabase) {
    throw new Error("Supabase client unavailable.");
  }

  const { error: updateError } = await appState.supabase
    .from("job_tasks")
    .update(mutation.patch)
    .eq("id", mutation.taskId);

  if (updateError) {
    throw updateError;
  }

  if (mutation.eventType) {
    const eventPayload = {
      task_id: mutation.taskId,
      event_type: mutation.eventType,
      payload: mutation.patch,
      created_at: new Date().toISOString(),
    };

    const { error: eventError } = await appState.supabase.from("task_events").insert(eventPayload);
    if (eventError) {
      throw eventError;
    }
  }
}

async function flushMutationQueue() {
  if (!appState.isOnline || !appState.supabase || appState.syncInFlight) {
    return;
  }
  if (appState.mutationQueue.length === 0) {
    return;
  }

  appState.syncInFlight = true;
  const pending = [...appState.mutationQueue];
  for (const mutation of pending) {
    try {
      await applyMutationRemote(mutation);
      appState.mutationQueue.shift();
      persistMutationQueue();
    } catch (error) {
      console.error("Mutation sync failed:", error);
      break;
    }
  }
  appState.syncInFlight = false;
}

function queueAndSync(mutations) {
  for (const mutation of mutations) {
    enqueueMutation(mutation);
  }
  flushMutationQueue();
}

function renderJobs() {
  const select = document.getElementById("job-list");
  select.innerHTML = "";

  if (appState.jobs.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No jobs found for this date";
    select.appendChild(empty);
    select.value = "";
    return;
  }

  for (const job of appState.jobs) {
    const option = document.createElement("option");
    option.value = job.id;
    const detailType = job.detailJobType ? ` (${job.detailJobType})` : "";
    option.textContent = `${job.customer} - ${job.vehicle}${detailType}`;
    select.appendChild(option);
  }
  select.value = appState.selectedJobId || "";
}

function renderSelectedDate() {
  const dateText = document.getElementById("current-date");
  const input = document.getElementById("job-date-picker");
  const listLabel = document.getElementById("job-list-label");
  const selected = appState.selectedDate || todayIsoDateLocal();

  if (input && input.value !== selected) {
    input.value = selected;
  }

  const dateObj = new Date(`${selected}T00:00:00`);
  const longDate = formatLongDate(dateObj);
  if (dateText) {
    dateText.textContent = longDate;
  }
  if (listLabel) {
    listLabel.textContent = `Jobs for ${longDate}`;
  }
}

function renderTaskList() {
  const list = document.getElementById("task-list");
  list.innerHTML = "";

  const ordered = [...appState.tasks].sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") {
      return 1;
    }
    if (a.status !== "completed" && b.status === "completed") {
      return -1;
    }
    if (a.status === "completed" && b.status === "completed") {
      return new Date(a.completed_at || 0).getTime() - new Date(b.completed_at || 0).getTime();
    }
    return a.priority - b.priority;
  });

  for (const task of ordered) {
    const li = document.createElement("li");
    li.className = `task-item ${task.status}`;

    const statusText =
      task.status === "completed"
        ? "Completed"
        : task.status === "running"
        ? "Running"
        : task.status === "paused"
        ? "Ready"
        : "Queued";

    li.innerHTML = `
      <div class="task-row">
        <strong>${task.priority}. ${task.title}</strong>
        <span class="badge">${statusText}</span>
      </div>
      <small>Elapsed: ${formatDuration(calculateElapsed(task))}</small>
    `;
    list.appendChild(li);
  }
}

function renderSlots() {
  const template = document.getElementById("task-slot-template");
  const orderedRunning = getRunningTasksOrdered();

  for (const slotIndex of slots) {
    const slotContainer = document.querySelector(`.task-slot[data-slot="${slotIndex}"]`);
    const task = orderedRunning[slotIndex];
    slotContainer.innerHTML = "";

    if (!task) {
      slotContainer.innerHTML = `
        <div class="slot-head"><span class="slot-label">Task ${slotIndex + 1}</span></div>
        <p class="slot-empty">No active task in this slot.</p>
      `;
      continue;
    }

    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".slot-label").textContent = `Task ${slotIndex + 1}`;
    fragment.querySelector(".status-pill").textContent =
      task.status === "running" ? "Running" : "Paused";
    fragment.querySelector(".task-title").textContent = task.title;
    fragment.querySelector(".task-priority").textContent = `Priority ${task.priority}`;
    fragment.querySelector(".timer").textContent = formatDuration(calculateElapsed(task));

    const startBtn = fragment.querySelector(".start");
    const pauseBtn = fragment.querySelector(".pause");
    const finishBtn = fragment.querySelector(".finish");

    startBtn.disabled = task.status === "running";
    pauseBtn.disabled = task.status !== "running";

    startBtn.addEventListener("click", () => startTask(task.id));
    pauseBtn.addEventListener("click", () => pauseTask(task.id));
    finishBtn.addEventListener("click", () => finishTask(task.id));

    slotContainer.appendChild(fragment);
  }
}

function render() {
  renderSelectedDate();
  renderJobs();
  renderTaskList();
  renderSlots();
  setConnectionPill();
}

function startTask(taskId) {
  const task = appState.tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running" || task.status === "completed") {
    return;
  }

  const patchTime = new Date().toISOString();
  updateTaskLocal(taskId, {
    status: "running",
    started_at: patchTime,
    updated_at: patchTime,
  });
  render();

  queueAndSync([
    {
      type: "task_update",
      taskId,
      patch: {
        status: "running",
        started_at: patchTime,
        updated_at: patchTime,
      },
      eventType: "start",
    },
  ]);
}

function pauseTask(taskId) {
  const task = appState.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "running") {
    return;
  }

  const patchTime = new Date().toISOString();
  const elapsed = calculateElapsed(task);
  updateTaskLocal(taskId, {
    status: "paused",
    elapsed_ms: elapsed,
    started_at: null,
    updated_at: patchTime,
  });
  render();

  queueAndSync([
    {
      type: "task_update",
      taskId,
      patch: {
        status: "paused",
        elapsed_ms: elapsed,
        started_at: null,
        updated_at: patchTime,
      },
      eventType: "pause",
    },
  ]);
}

function finishTask(taskId) {
  const task = appState.tasks.find((item) => item.id === taskId);
  if (!task || task.status === "completed") {
    return;
  }

  const patchTime = new Date().toISOString();
  const elapsed = calculateElapsed(task);

  updateTaskLocal(taskId, {
    status: "completed",
    elapsed_ms: elapsed,
    started_at: null,
    completed_at: patchTime,
    updated_at: patchTime,
  });

  const refillMutations = refillActiveSlots();
  render();

  queueAndSync([
    {
      type: "task_update",
      taskId,
      patch: {
        status: "completed",
        elapsed_ms: elapsed,
        started_at: null,
        completed_at: patchTime,
        updated_at: patchTime,
      },
      eventType: "finish",
    },
    ...refillMutations,
  ]);
}

async function loadJobsFromCloud() {
  if (!appState.supabase) {
    return;
  }

  const { data, error } = await appState.supabase
    .from("jobs")
    .select("id, external_job_id, customer, vehicle, detail_job_type, service_date, created_at")
    .eq("service_date", appState.selectedDate)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load jobs:", error);
    return;
  }

  appState.jobs = (data || []).map((row) => ({
    id: row.id,
    externalJobId: row.external_job_id,
    customer: row.customer,
    vehicle: row.vehicle,
    detailJobType: row.detail_job_type,
    serviceDate: row.service_date,
    createdAt: row.created_at,
  }));

  const selectedStillExists = appState.jobs.some((job) => job.id === appState.selectedJobId);
  if (!selectedStillExists) {
    appState.selectedJobId = appState.jobs.length > 0 ? appState.jobs[0].id : null;
    appState.tasks = appState.selectedJobId ? appState.taskCacheByJob[appState.selectedJobId] || [] : [];
  }

  persistCachedState();
  renderJobs();
}

async function setSelectedDate(nextDate) {
  if (!nextDate || nextDate === appState.selectedDate) {
    return;
  }

  appState.selectedDate = nextDate;
  appState.jobs = [];
  appState.selectedJobId = null;
  appState.tasks = [];
  persistCachedState();
  render();

  if (appState.isOnline && appState.supabase) {
    await loadJobsFromCloud();
    if (appState.selectedJobId) {
      await loadTasksForJob(appState.selectedJobId);
    } else {
      render();
    }
  }
}

async function loadTasksForJob(jobId) {
  if (!appState.supabase || !jobId) {
    return;
  }

  const { data, error } = await appState.supabase
    .from("job_tasks")
    .select("id, job_id, title, priority, status, elapsed_ms, started_at, completed_at, updated_at")
    .eq("job_id", jobId)
    .order("priority", { ascending: true });

  if (error) {
    console.error("Failed to load tasks:", error);
    return;
  }

  appState.tasks = data || [];
  const refillMutations = refillActiveSlots();
  appState.taskCacheByJob[jobId] = appState.tasks;
  persistCachedState();
  render();
  if (refillMutations.length > 0) {
    queueAndSync(refillMutations);
  }
}

async function selectJob(jobId) {
  if (!jobId) {
    appState.selectedJobId = null;
    appState.tasks = [];
    render();
    persistCachedState();
    return;
  }

  appState.selectedJobId = jobId;
  appState.tasks = appState.taskCacheByJob[jobId] || [];
  render();

  if (appState.isOnline) {
    await loadTasksForJob(jobId);
  } else {
    const refillMutations = refillActiveSlots();
    if (refillMutations.length > 0) {
      for (const mutation of refillMutations) {
        enqueueMutation(mutation);
      }
    }
    render();
  }

  persistCachedState();
}

function setupTicker() {
  appState.timerHandle = setInterval(() => {
    if (appState.tasks.some((task) => task.status === "running")) {
      renderTaskList();
      renderSlots();
    }
  }, TICK_MS);
}

function setupOnlineOfflineHandlers() {
  window.addEventListener("online", async () => {
    appState.isOnline = true;
    setConnectionPill();
    await syncNow();
  });

  window.addEventListener("offline", () => {
    appState.isOnline = false;
    setConnectionPill();
  });
}

function setupPolling() {
  appState.pollHandle = setInterval(async () => {
    if (!appState.isOnline || !appState.supabase) {
      return;
    }
    if (appState.syncInFlight) {
      return;
    }

    await loadJobsFromCloud();
    if (appState.selectedJobId) {
      await loadTasksForJob(appState.selectedJobId);
    }
    await flushMutationQueue();
  }, POLL_MS);
}

async function syncNow() {
  if (!appState.isOnline || !appState.supabase) {
    return;
  }
  await loadJobsFromCloud();
  if (appState.selectedJobId) {
    await loadTasksForJob(appState.selectedJobId);
  }
  await flushMutationQueue();
}

function initSupabaseClient() {
  if (!window.supabase || !hasSupabaseConfig()) {
    return false;
  }
  const config = getConfig();
  appState.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  return true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.error("Service worker registration failed:", error);
  });
}

function setupUiEvents() {
  applyTheme();
  renderSelectedDate();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    toggleTheme();
  });
  document.getElementById("job-date-picker").addEventListener("change", (event) => {
    setSelectedDate(event.target.value);
  });
  document.getElementById("job-list").addEventListener("change", (event) => {
    selectJob(event.target.value);
  });
  document.getElementById("sync-now").addEventListener("click", () => {
    syncNow();
  });
}

window.GLDTaskTracker = {
  syncNow,
};

async function init() {
  loadCachedState();
  loadMutationQueue();
  loadThemePreference();
  setupUiEvents();
  setConnectionPill();
  render();
  setupTicker();
  setupOnlineOfflineHandlers();
  registerServiceWorker();

  const hasCloud = initSupabaseClient();
  if (!hasCloud) {
    console.warn("Missing Supabase config. Populate config.js before production use.");
    return;
  }

  if (appState.isOnline) {
    await syncNow();
  }
  setupPolling();
}

init();
