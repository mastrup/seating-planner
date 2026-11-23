(function () {
const { STORAGE_KEY, LIMITS, createPlan, validatePlan, tableSize, clampPosition, occupancy, assignGuest, linkGuests, unlinkGuest, renameGroup, moveGuestToGroup, moveGuestToSeat, removeTable, removeRoom } = globalThis.GatherModel;

const { t, errorMessage } = globalThis.GatherI18n;
GatherI18n.setLocale(GatherI18n.initialLocale());

const $ = id => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
};
let plan = createPlan(t("plan.defaultName"));
let saveStatusKey = "status.saved";
let activeRoomId = null;
let selectedTableId = null;
let editor = null;
let notificationTimer;
let groupDragGuestId = null;

function notify(message, error = false) {
  clearTimeout(notificationTimer);
  $("notification").textContent = message;
  $("notification").classList.toggle("error", error);
  $("notification").hidden = false;
  notificationTimer = setTimeout(() => { $("notification").hidden = true; }, error ? 10000 : 4500);
}

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) plan = validatePlan(JSON.parse(stored));
} catch (error) {
  setSaveStatus("status.loadFailed");
  notify(t("plan.loadFailed", { message: errorMessage(error) }), true);
}
activeRoomId = plan.rooms[0]?.id ?? null;

function setSaveStatus(key) {
  saveStatusKey = key;
  $("save-status").textContent = t(key);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    setSaveStatus("status.saved");
  } catch (error) {
    setSaveStatus("status.notSaved");
    notify(t("plan.saveFailed", { message: errorMessage(error) }), true);
  }
}

function commit(nextPlan) {
  plan = validatePlan(nextPlan);
  render();
  save();
}

function currentRoom() {
  return plan.rooms.find(room => room.id === activeRoomId);
}

function render() {
  if (!currentRoom()) activeRoomId = plan.rooms[0]?.id ?? null;
  if (!plan.tables.some(table => table.id === selectedTableId && table.roomId === activeRoomId)) selectedTableId = null;
  $("venue-title").textContent = plan.name;
  document.title = plan.name;
  $("room-count").textContent = plan.rooms.length;
  $("table-count").textContent = plan.tables.length;
  $("guest-count").textContent = plan.guests.length;
  $("guest-badge").textContent = plan.guests.length;
  const seated = plan.guests.filter(guest => guest.tableId !== null).length;
  $("seated-count").textContent = seated;
  $("available-count").textContent = plan.tables.reduce((sum, table) => sum + table.capacity, 0) - seated;
  renderRooms();
  renderGuests();
  renderDetails();
  if (!$("groups-panel").hidden) renderGroups();
}

function renderRooms() {
  $("room-tabs").replaceChildren();
  for (const room of plan.rooms) {
    const tab = element("button", "", room.name);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(room.id === activeRoomId));
    tab.addEventListener("click", () => { activeRoomId = room.id; selectedTableId = null; render(); });
    $("room-tabs").append(tab);
  }
  const room = currentRoom();
  $("edit-room").disabled = !room;
  $("add-table").disabled = !room;
  $("room-title").textContent = room?.name ?? t("room.createFirst");
  const roomTableCount = plan.tables.filter(table => table.roomId === room?.id).length;
  $("room-dimensions").textContent = room
    ? t("room.dimensionsWithTables", { width: room.width, height: room.height, count: roomTableCount })
    : t("room.startHint");
  const canvas = $("room-canvas");
  if (!room) {
    canvas.style.aspectRatio = "1.5";
    canvas.replaceChildren();
    const empty = element("div", "canvas-empty");
    empty.append(element("span", "empty-icon", "+"), element("h3", "", t("room.emptyTitle")), element("p", "", t("room.emptyText")));
    const button = element("button", "primary", t("room.create"));
    button.addEventListener("click", () => openEditor("room"));
    empty.append(button);
    canvas.append(empty);
    return;
  }
  canvas.style.aspectRatio = `${room.width} / ${room.height}`;
  canvas.setAttribute("aria-label", t("room.floorPlanNamed", { name: room.name, width: room.width, height: room.height }));
  canvas.replaceChildren();
  const tables = plan.tables.filter(table => table.roomId === room.id);
  if (!tables.length) {
    const empty = element("div", "canvas-empty");
    empty.append(element("span", "empty-icon", "+"), element("h3", "", t("room.noTablesTitle")), element("p", "", t("room.noTablesText")));
    canvas.append(empty);
  }
  for (const table of tables) canvas.append(makeTable(table, room, true));
}

function positionTable(node, table, room) {
  const size = tableSize(table);
  node.style.left = `${table.x / room.width * 100}%`;
  node.style.top = `${table.y / room.height * 100}%`;
  node.style.width = `${size.width / room.width * 100}%`;
  node.style.height = `${size.height / room.height * 100}%`;
}

function makeTable(table, room, interactive) {
  const count = occupancy(plan, table.id);
  const wrap = element("div", "table-wrap");
  const node = element(interactive ? "button" : "div", `floor-table ${table.shape}`);
  node.classList.toggle("full-table", count >= table.capacity);
  node.classList.toggle("selected", interactive && table.id === selectedTableId);
  positionTable(wrap, table, room);
  node.append(element("strong", "", table.name), element("small", "", `${count} / ${table.capacity}`));
  wrap.append(node, ...makeSeats(table, interactive));
  if (!interactive) return wrap;
  node.type = "button";
  node.dataset.tableId = table.id;
  node.setAttribute("aria-label", t("table.aria", { name: table.name, count, capacity: table.capacity }));
  node.title = t("table.tooltip", { name: table.name, count, capacity: table.capacity });
  node.addEventListener("click", () => selectTable(table.id));
  node.addEventListener("keydown", event => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!moves[event.key]) return;
    event.preventDefault();
    const [dx, dy] = moves[event.key];
    const step = event.shiftKey ? 0.5 : 0.1;
    const next = structuredClone(plan);
    const moved = next.tables.find(item => item.id === table.id);
    Object.assign(moved, clampPosition(moved, room, moved.x + dx * step, moved.y + dy * step));
    selectedTableId = table.id;
    commit(next);
    focusTable(table.id);
  });
  node.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    selectTable(table.id);
    node.focus();
    const bounds = $("room-canvas").getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, tableX: table.x, tableY: table.y };
    let position = { x: table.x, y: table.y };
    node.setPointerCapture(event.pointerId);
    node.classList.add("dragging");
    const move = moveEvent => {
      position = clampPosition(table, room,
        start.tableX + (moveEvent.clientX - start.x) / bounds.width * room.width,
        start.tableY + (moveEvent.clientY - start.y) / bounds.height * room.height);
      positionTable(wrap, { ...table, ...position }, room);
    };
    const finish = finishEvent => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", finish);
      node.removeEventListener("pointercancel", finish);
      node.classList.remove("dragging");
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      if (finishEvent.type === "pointercancel") {
        positionTable(wrap, table, room);
      } else if (position.x !== table.x || position.y !== table.y) {
        const next = structuredClone(plan);
        Object.assign(next.tables.find(item => item.id === table.id), position);
        commit(next);
        focusTable(table.id);
      }
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", finish);
  });
  node.addEventListener("dragover", event => {
    if (!event.dataTransfer.types.includes("application/x-gather-guest")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    node.classList.add("drop-target");
  });
  node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
  node.addEventListener("drop", event => {
    event.preventDefault();
    node.classList.remove("drop-target");
    const guestId = event.dataTransfer.getData("application/x-gather-guest");
    if (guestId) changeAssignment(guestId, table.id);
  });
  return wrap;
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase();
}

// Seats run clockwise from the top: around the circle for round tables, along the perimeter otherwise.
function seatSlot(table, index, count) {
  const fraction = (index + 0.5) / count;
  const size = tableSize(table);
  if (table.shape === "round") {
    const angle = fraction * 2 * Math.PI - Math.PI / 2;
    return { x: 50 + 50 * Math.cos(angle), y: 50 + 50 * Math.sin(angle), nx: Math.cos(angle), ny: Math.sin(angle) };
  }
  const s = fraction * 2 * (size.width + size.height);
  if (s < size.width) return { x: s / size.width * 100, y: 0, nx: 0, ny: -1 };
  if (s < size.width + size.height) return { x: 100, y: (s - size.width) / size.height * 100, nx: 1, ny: 0 };
  if (s < 2 * size.width + size.height) return { x: 100 - (s - size.width - size.height) / size.width * 100, y: 100, nx: 0, ny: 1 };
  return { x: 0, y: 100 - (s - 2 * size.width - size.height) / size.height * 100, nx: -1, ny: 0 };
}

const SEAT_OFFSET = 17;

function makeSeats(table, interactive) {
  const guests = plan.guests.filter(guest => guest.tableId === table.id);
  return guests.map((guest, index) => {
    const slot = seatSlot(table, index, guests.length);
    const seat = element("span", "seat", initials(guest.name));
    seat.append(element("span", "seat-tip", guest.name));
    seat.style.left = `calc(${slot.x}% + ${slot.nx * SEAT_OFFSET}px)`;
    seat.style.top = `calc(${slot.y}% + ${slot.ny * SEAT_OFFSET}px)`;
    if (!interactive) return seat;
    seat.dataset.guestId = guest.id;
    seat.tabIndex = 0;
    seat.setAttribute("role", "button");
    seat.setAttribute("aria-label", t("seat.aria", { name: guest.name, index: index + 1, total: guests.length, table: table.name }));
    seat.addEventListener("click", () => {
      if (seat.dataset.justDragged) { delete seat.dataset.justDragged; return; }
      const open = !seat.classList.contains("revealed");
      for (const other of document.querySelectorAll(".seat.revealed")) other.classList.remove("revealed");
      seat.classList.toggle("revealed", open);
    });
    seat.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); seat.click(); return; }
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (!step || index + step < 0 || index + step >= guests.length) return;
      event.preventDefault();
      moveSeat(guest.id, index + step, false);
      focusSeat(guest.id);
    });
    seat.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const wrap = seat.parentElement;
      const rect = wrap.getBoundingClientRect();
      const slots = guests.map((_, i) => {
        const s = seatSlot(table, i, guests.length);
        return { x: rect.left + s.x / 100 * rect.width + s.nx * SEAT_OFFSET, y: rect.top + s.y / 100 * rect.height + s.ny * SEAT_OFFSET };
      });
      const start = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let target = index;
      let otherWrap = null;
      seat.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) < 5) return;
        if (!dragging) {
          dragging = true;
          seat.classList.add("dragging");
          seat.classList.remove("revealed");
          wrap.classList.add("seat-sorting");
        }
        seat.style.transform = `translate(${dx}px, ${dy}px)`;
        otherWrap?.querySelector(".floor-table")?.classList.remove("drop-target");
        otherWrap = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
          .map(node => node.closest(".table-wrap")).find(node => node && node !== wrap) ?? null;
        wrap.querySelectorAll(".seat-slot").forEach(node => node.remove());
        if (otherWrap) {
          otherWrap.querySelector(".floor-table")?.classList.add("drop-target");
          return;
        }
        const px = slots[index].x + dx;
        const py = slots[index].y + dy;
        target = slots.reduce((best, slotPosition, i) => Math.hypot(slotPosition.x - px, slotPosition.y - py) < Math.hypot(slots[best].x - px, slots[best].y - py) ? i : best, 0);
        const marker = element("span", "seat-slot");
        marker.style.left = `${slots[target].x - rect.left}px`;
        marker.style.top = `${slots[target].y - rect.top}px`;
        wrap.append(marker);
      };
      const finish = finishEvent => {
        seat.removeEventListener("pointermove", move);
        seat.removeEventListener("pointerup", finish);
        seat.removeEventListener("pointercancel", finish);
        if (seat.hasPointerCapture(event.pointerId)) seat.releasePointerCapture(event.pointerId);
        wrap.querySelectorAll(".seat-slot").forEach(node => node.remove());
        wrap.classList.remove("seat-sorting");
        seat.classList.remove("dragging");
        seat.style.transform = "";
        if (!dragging) return;
        seat.dataset.justDragged = "1";
        setTimeout(() => delete seat.dataset.justDragged, 0);
        otherWrap?.querySelector(".floor-table")?.classList.remove("drop-target");
        const newTableId = otherWrap?.querySelector("[data-table-id]")?.dataset.tableId;
        if (finishEvent.type === "pointerup" && newTableId) {
          changeAssignment(guest.id, newTableId);
        } else if (finishEvent.type === "pointerup" && target !== index) {
          moveSeat(guest.id, target, false);
          focusSeat(guest.id);
        }
      };
      seat.addEventListener("pointermove", move);
      seat.addEventListener("pointerup", finish);
      seat.addEventListener("pointercancel", finish);
    });
    return seat;
  });
}

function focusSeat(guestId) {
  Array.from($("room-canvas").querySelectorAll(".seat")).find(node => node.dataset.guestId === guestId)?.focus({ preventScroll: true });
}

function selectTable(tableId) {
  selectedTableId = tableId;
  for (const node of $("room-canvas").querySelectorAll("[data-table-id]")) node.classList.toggle("selected", node.dataset.tableId === tableId);
  renderDetails();
}

function focusTable(tableId) {
  Array.from($("room-canvas").querySelectorAll("[data-table-id]"))
    .find(node => node.dataset.tableId === tableId)?.focus({ preventScroll: true });
}

function changeAssignment(guestId, tableId) {
  try {
    const next = structuredClone(plan);
    assignGuest(next, guestId, tableId);
    commit(next);
  } catch (error) {
    notify(errorMessage(error), true);
    renderGuests();
  }
}

function renderGuests() {
  const list = $("guest-list");
  list.replaceChildren();
  const query = $("guest-search").value.toLocaleLowerCase();
  const guests = plan.guests.filter(guest => guest.name.toLocaleLowerCase().includes(query) && (!$("unseated-only").checked || guest.tableId === null));
  if (!guests.length) list.append(element("p", "empty-list", t(plan.guests.length ? "guests.noMatch" : "guests.empty")));
  const rooms = new Map(plan.rooms.map(room => [room.id, room]));
  for (const guest of guests) {
    const card = element("div", "guest-card");
    card.draggable = true;
    card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("application/x-gather-guest", guest.id);
      event.dataTransfer.effectAllowed = "move";
    });
    const top = element("div", "guest-top");
    const initials = guest.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase();
    const remove = element("button", "icon-button", "\u00d7");
    remove.setAttribute("aria-label", t("guest.remove", { name: guest.name }));
    remove.addEventListener("click", () => {
      if (!confirm(t("guest.removeConfirm", { name: guest.name }))) return;
      const next = structuredClone(plan);
      next.guests = next.guests.filter(item => item.id !== guest.id);
      commit(next);
    });
    const nameLabel = element("span", "guest-name", guest.name);
    const rename = element("button", "icon-button rename-button", "\u270E");
    rename.type = "button";
    rename.setAttribute("aria-label", t("guest.rename", { name: guest.name }));
    rename.title = t("guest.renameTitle");
    const startRename = () => {
      const input = element("input", "rename-input");
      input.value = guest.name;
      input.maxLength = 100;
      input.setAttribute("aria-label", t("guest.newName", { name: guest.name }));
      let done = false;
      const finish = save => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!save || !name || name === guest.name) { renderGuests(); return; }
        try {
          const next = structuredClone(plan);
          next.guests.find(item => item.id === guest.id).name = name;
          commit(next);
        } catch (error) {
          notify(errorMessage(error), true);
          renderGuests();
        }
      };
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); finish(true); }
        else if (event.key === "Escape") { event.stopPropagation(); finish(false); }
      });
      input.addEventListener("blur", () => finish(true));
      card.draggable = false;
      nameLabel.replaceWith(input);
      rename.hidden = true;
      input.focus();
      input.select();
    };
    rename.addEventListener("click", startRename);
    nameLabel.addEventListener("dblclick", startRename);
    top.append(element("span", "avatar", initials), nameLabel, rename, remove);
    const select = element("select");
    select.dataset.guestId = guest.id;
    select.setAttribute("aria-label", t("guest.tableFor", { name: guest.name }));
    select.append(new Option(t("guest.unseated"), ""));
    const group = guest.linkId ? plan.guests.filter(item => item.linkId === guest.linkId) : [guest];
    for (const table of plan.tables) {
      const count = occupancy(plan, table.id);
      const option = new Option(`${rooms.get(table.roomId).name} / ${table.name} (${count}/${table.capacity})`, table.id);
      option.disabled = guest.tableId !== table.id && count + group.filter(item => item.tableId !== table.id).length > table.capacity;
      select.append(option);
    }
    select.value = guest.tableId ?? "";
    select.addEventListener("change", () => {
      changeAssignment(guest.id, select.value || null);
      Array.from($("guest-list").querySelectorAll("select"))
        .find(node => node.dataset.guestId === guest.id)?.focus({ preventScroll: true });
    });
    card.append(top, select, makeLinkRow(guest, group));
    list.append(card);
  }
}

function makeLinkRow(guest, group) {
  const row = element("div", "link-row");
  if (group.length > 1) {
    row.classList.add("linked");
    row.append(element("span", "link-names", t("guest.seatedWith", { names: group.filter(item => item !== guest).map(item => item.name).join(", ") })));
    const unlink = element("button", "link-button", t("guest.unlink"));
    unlink.type = "button";
    unlink.setAttribute("aria-label", t("guest.unlinkLabel", { name: guest.name }));
    unlink.addEventListener("click", () => {
      changeLink(guest.id);
    });
    row.append(unlink);
  }
  const picker = element("select", "link-select");
  picker.setAttribute("aria-label", t("guest.linkLabel", { name: guest.name }));
  picker.append(new Option(t(group.length > 1 ? "guest.addLink" : "guest.linkWith"), ""));
  for (const other of plan.guests) if (!group.includes(other)) picker.append(new Option(other.name, other.id));
  picker.addEventListener("change", () => {
    if (!picker.value) return;
    changeLink(guest.id, picker.value);
  });
  row.append(picker);
  return row;
}

function changeLink(guestId, otherId = null) {
  $("groups-error").hidden = true;
  try {
    const next = structuredClone(plan);
    if (otherId === null) unlinkGuest(next, guestId);
    else linkGuests(next, guestId, otherId);
    commit(next);
    notify(t(otherId === null ? "link.unlinked" : "link.linked"));
    return true;
  } catch (error) {
    reportGroupError(error);
    renderGuests();
    return false;
  }
}

function reportGroupError(error) {
  const message = errorMessage(error);
  notify(message, true);
  if (!$("groups-panel").hidden) {
    $("groups-error").textContent = message;
    $("groups-error").hidden = false;
  }
}

function changeGroup(guestId, targetId) {
  if (targetId === null) return changeLink(guestId);
  $("groups-error").hidden = true;
  try {
    const next = structuredClone(plan);
    moveGuestToGroup(next, guestId, targetId);
    commit(next);
    notify(t("link.moved"));
    focusGroupControl(targetId);
  } catch (error) {
    reportGroupError(error);
  }
}

function validGroupDrop(target) {
  const guest = plan.guests.find(item => item.id === groupDragGuestId);
  if (!guest) return false;
  if (target === $("group-unlink-drop")) return Boolean(guest.linkId);
  const other = plan.guests.find(item => item.id === target.dataset.guestId);
  return Boolean(other && other.id !== guest.id && (!guest.linkId || guest.linkId !== other.linkId));
}

function clearGroupDropTargets() {
  for (const node of $("groups-panel").querySelectorAll(".group-drop-target")) node.classList.remove("group-drop-target");
}

function makeGroupDropTarget(node, targetId) {
  node.addEventListener("dragover", event => {
    if (!event.dataTransfer.types.includes("application/x-gather-group-member") || !validGroupDrop(node)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearGroupDropTargets();
    node.classList.add("group-drop-target");
  });
  node.addEventListener("dragleave", event => {
    if (!node.contains(event.relatedTarget)) node.classList.remove("group-drop-target");
  });
  node.addEventListener("drop", event => {
    if (!event.dataTransfer.types.includes("application/x-gather-group-member")) return;
    event.preventDefault();
    const guestId = event.dataTransfer.getData("application/x-gather-group-member");
    const valid = guestId === groupDragGuestId && validGroupDrop(node);
    clearGroupDropTargets();
    groupDragGuestId = null;
    if (valid) changeGroup(guestId, targetId);
  });
}

function makeGroupDraggable(member, handle, guest) {
  member.draggable = true;
  member.dataset.guestId = guest.id;
  member.addEventListener("dragstart", event => {
    if (event.target.closest("button")) { event.preventDefault(); return; }
    groupDragGuestId = guest.id;
    event.dataTransfer.setData("application/x-gather-group-member", guest.id);
    event.dataTransfer.effectAllowed = "move";
    member.classList.add("group-dragging");
  });
  member.addEventListener("dragend", () => {
    groupDragGuestId = null;
    member.classList.remove("group-dragging");
    clearGroupDropTargets();
  });
  handle.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || event.button !== 0) return;
    event.preventDefault();
    groupDragGuestId = guest.id;
    handle.setPointerCapture(event.pointerId);
    const ghost = element("div", "group-drag-ghost", guest.name);
    $("groups-panel").append(ghost);
    member.classList.add("group-dragging");
    let target = null;
    const move = moveEvent => {
      ghost.style.left = `${moveEvent.clientX + 12}px`;
      ghost.style.top = `${moveEvent.clientY + 12}px`;
      target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".group-card, #group-unlink-drop") ?? null;
      clearGroupDropTargets();
      if (target && validGroupDrop(target)) target.classList.add("group-drop-target");
    };
    const finish = finishEvent => {
      if (finishEvent.type === "pointerup") move(finishEvent);
      const valid = finishEvent.type === "pointerup" && target && validGroupDrop(target);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      ghost.remove();
      member.classList.remove("group-dragging");
      clearGroupDropTargets();
      groupDragGuestId = null;
      if (valid) changeGroup(guest.id, target === $("group-unlink-drop") ? null : target.dataset.guestId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    move(event);
  });
}

function renderGroups() {
  const groups = new Map();
  const singles = [];
  for (const guest of plan.guests) {
    if (!guest.linkId) singles.push(guest);
    else {
      if (!groups.has(guest.linkId)) groups.set(guest.linkId, []);
      groups.get(guest.linkId).push(guest);
    }
  }
  const tables = new Map(plan.tables.map(table => [table.id, table]));
  const rooms = new Map(plan.rooms.map(room => [room.id, room]));
  const location = guest => {
    const table = tables.get(guest.tableId);
    return table ? `${rooms.get(table.roomId).name} / ${table.name}` : t("guest.unseated");
  };
  const query = $("group-search").value.trim().toLocaleLowerCase();
  const matches = guest => guest.name.toLocaleLowerCase().includes(query);
  const cards = $("group-cards");
  cards.replaceChildren();
  const makeCard = (members, title, linked, linkId = null, defaultGroupName = "") => {
    const section = element("section", "group-card");
    section.dataset.guestId = members[0].id;
    makeGroupDropTarget(section, members[0].id);
    section.setAttribute("aria-label", title);
    const heading = element("div", "group-heading");
    const titleNode = element("h3", "", title);
    heading.append(titleNode);
    if (linked) {
      const rename = element("button", "icon-button group-rename-button", "\u270E");
      rename.type = "button";
      rename.title = t("groups.rename");
      rename.setAttribute("aria-label", t("groups.renameLabel", { name: defaultGroupName }));
      rename.addEventListener("click", () => {
        const form = element("form", "group-name-editor");
        const input = element("input", "group-name-input");
        input.value = plan.groupNames[linkId] ?? defaultGroupName;
        input.maxLength = 100;
        input.required = true;
        input.setAttribute("aria-label", t("groups.nameLabel", { name: defaultGroupName }));
        const saveName = element("button", "primary", t("groups.save"));
        saveName.type = "submit";
        const cancel = element("button", "", t("groups.cancel"));
        cancel.type = "button";
        cancel.addEventListener("click", renderGroups);
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (!input.reportValidity()) return;
          try {
            const next = structuredClone(plan);
            renameGroup(next, linkId, input.value);
            commit(next);
          } catch (error) {
            reportGroupError(error);
          }
        });
        form.append(input, saveName, cancel);
        heading.replaceWith(form);
        input.focus();
        input.select();
      });
      heading.append(rename);
    }
    section.append(heading);
    const list = element("ul", "group-members");
    for (const guest of members) {
      const member = element("li", "group-member");
      const name = element("div");
      name.append(element("strong", "", guest.name), element("small", "", location(guest)));
      const handle = element("span", "group-drag-handle", "::");
      handle.title = t("groups.dragTitle", { name: guest.name });
      handle.setAttribute("aria-hidden", "true");
      member.append(handle, element("span", "avatar", initials(guest.name)), name);
      makeGroupDraggable(member, handle, guest);
      if (linked) {
        const remove = element("button", "", t("groups.remove"));
        remove.type = "button";
        remove.setAttribute("aria-label", t("groups.removeLabel", { name: guest.name }));
        remove.addEventListener("click", () => {
          if (changeLink(guest.id)) focusGroupControl(members.find(item => item.id !== guest.id).id);
        });
        member.append(remove);
      }
      list.append(member);
    }
    section.append(list);
    const form = element("form", "group-add");
    const picker = element("select");
    picker.required = true;
    picker.setAttribute("aria-label", linked ? t("groups.addPersonLabel", { title }) : t("groups.linkPersonLabel", { name: members[0].name }));
    picker.append(new Option(t(linked ? "groups.chooseAdd" : "groups.chooseLink"), ""));
    const memberIds = new Set(members.map(guest => guest.id));
    for (const guest of plan.guests) {
      if (memberIds.has(guest.id)) continue;
      picker.append(new Option(`${guest.name} - ${location(guest)}${guest.linkId ? t("groups.mergesGroup") : ""}`, guest.id));
    }
    const add = element("button", "primary", t(linked ? "groups.addToGroup" : "groups.link"));
    add.type = "submit";
    add.disabled = true;
    picker.addEventListener("change", () => { add.disabled = !picker.value; });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (changeLink(members[0].id, picker.value)) focusGroupControl(members[0].id);
    });
    form.append(picker, add);
    section.append(form);
    return section;
  };
  let groupNumber = 0;
  for (const [linkId, members] of groups) {
    groupNumber++;
    const groupName = plan.groupNames[linkId];
    const defaultGroupName = groupName || t("groups.defaultName", { number: groupNumber });
    const title = t("groups.cardTitle", { name: defaultGroupName, count: members.length });
    if (!members.some(matches) && !title.toLocaleLowerCase().includes(query)) continue;
    cards.append(makeCard(members, title, true, linkId, defaultGroupName));
  }
  if (!$("linked-only").checked) {
    for (const guest of singles.filter(matches)) cards.append(makeCard([guest], t("groups.notLinked"), false));
  }
  if (!cards.children.length) cards.append(element("p", "empty-list", t(plan.guests.length ? "groups.noMatch" : "groups.empty")));
}

function focusGroupControl(id) {
  const card = Array.from($("group-cards").children).find(node => node.dataset.guestId === id);
  (card?.querySelector("select") ?? $("group-search")).focus({ preventScroll: true });
}

function selectPlanningTab(tab) {
  for (const item of $("planning-tabs").querySelectorAll('[role="tab"]')) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute("aria-controls")).hidden = !selected;
  }
  if (!$("groups-panel").hidden) renderGroups();
}

function renderDetails() {
  const details = $("table-details");
  const table = plan.tables.find(item => item.id === selectedTableId);
  details.hidden = !table;
  details.replaceChildren();
  if (!table) return;
  const guests = plan.guests.filter(guest => guest.tableId === table.id);
  const heading = element("div", "details-heading");
  const title = element("div");
  title.append(element("h3", "", table.name), element("p", "helper", t("table.summary", { count: guests.length, capacity: table.capacity, width: table.width, height: table.height })));
  const edit = element("button", "", t("table.edit"));
  edit.addEventListener("click", () => openEditor("table", table.id));
  heading.append(title, edit);
  details.append(heading);
  const chips = element("div", "assigned-guests");
  if (!guests.length) chips.append(element("p", "muted", t("table.noGuests")));
  else details.append(element("p", "helper", t("table.seatHelp")));
  guests.forEach((guest, index) => {
    const chip = element("span", "guest-chip");
    chip.draggable = true;
    chip.dataset.guestId = guest.id;
    chip.append(element("span", "chip-number", String(index + 1)), element("span", "", guest.name));
    const reorder = (key, glyph, target) => {
      const button = element("button", "icon-button", glyph);
      button.type = "button";
      button.setAttribute("aria-label", t(key, { name: guest.name }));
      button.disabled = target < 0 || target >= guests.length;
      button.addEventListener("click", () => moveSeat(guest.id, target, true));
      return button;
    };
    const remove = element("button", "icon-button", "\u00d7");
    remove.setAttribute("aria-label", t("table.unseat", { name: guest.name }));
    remove.addEventListener("click", () => changeAssignment(guest.id, null));
    chip.append(reorder("table.moveEarlier", "\u25c0", index - 1), reorder("table.moveLater", "\u25b6", index + 1), remove);
    chip.addEventListener("dragstart", event => {
      event.dataTransfer.setData("application/x-gather-seat", guest.id);
      event.dataTransfer.effectAllowed = "move";
    });
    chip.addEventListener("dragover", event => {
      if (!event.dataTransfer.types.includes("application/x-gather-seat")) return;
      event.preventDefault();
      chip.classList.add("drop-target");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("drop-target"));
    chip.addEventListener("drop", event => {
      event.preventDefault();
      chip.classList.remove("drop-target");
      const draggedId = event.dataTransfer.getData("application/x-gather-seat");
      if (draggedId && draggedId !== guest.id) moveSeat(draggedId, index, false);
    });
    chips.append(chip);
  });
  details.append(chips);
}

function moveSeat(guestId, seatIndex, keepFocus) {
  try {
    const next = structuredClone(plan);
    moveGuestToSeat(next, guestId, seatIndex);
    commit(next);
    if (keepFocus) {
      const chip = Array.from($("table-details").querySelectorAll(".guest-chip")).find(node => node.dataset.guestId === guestId);
      (chip?.querySelector("button:not(:disabled)"))?.focus({ preventScroll: true });
    }
  } catch (error) { notify(errorMessage(error), true); }
}

function field(label, name, value, options = {}) {
  const wrapper = element("div", "field");
  const caption = element("label", "", label);
  caption.htmlFor = `field-${name}`;
  const input = element(options.choices ? "select" : "input");
  input.id = caption.htmlFor;
  input.name = name;
  if (options.choices) {
    for (const [key, title] of options.choices) input.append(new Option(title, key));
  } else {
    input.type = options.type ?? "text";
    if (input.type === "number") {
      input.min = options.min;
      input.max = options.max;
      input.step = options.step ?? "0.1";
    } else input.maxLength = 100;
  }
  input.value = value;
  input.required = true;
  wrapper.append(caption, input);
  return wrapper;
}

function openEditor(kind, id = null) {
  editor = { kind, id };
  $("dialog-error").hidden = true;
  $("delete-item").hidden = !id || kind === "venue";
  const fields = $("dialog-fields");
  fields.replaceChildren();
  const room = currentRoom();
  if (kind === "venue") {
    $("dialog-title").textContent = t("venue.nameTitle");
    fields.append(field(t("venue.nameLabel"), "name", plan.name));
  } else if (kind === "room") {
    const item = plan.rooms.find(value => value.id === id);
    $("dialog-title").textContent = t(item ? "room.editTitle" : "room.createTitle");
    fields.append(field(t("room.nameLabel"), "name", item?.name ?? t("room.defaultName", { number: plan.rooms.length + 1 })));
    const row = element("div", "field-row");
    row.append(field(t("room.widthLabel"), "width", item?.width ?? 12, { type: "number", min: 2, max: 100 }),
      field(t("room.lengthLabel"), "height", item?.height ?? 8, { type: "number", min: 2, max: 100 }));
    fields.append(row, element("p", "helper", t("room.sizeHelp")));
  } else {
    if (!room) return;
    const item = plan.tables.find(value => value.id === id);
    $("dialog-title").textContent = t(item ? "table.edit" : "table.addTitle");
    fields.append(field(t("table.nameLabel"), "name", item?.name ?? t("table.defaultName", { number: plan.tables.length + 1 })),
      field(t("table.shapeLabel"), "shape", item?.shape ?? "round", { choices: [["round", t("table.round")], ["rectangle", t("table.rectangle")]] }),
      field(t("table.seatsLabel"), "capacity", item?.capacity ?? 8, { type: "number", min: 1, max: 100, step: 1 }));
    const row = element("div", "field-row");
    row.append(field(t("table.widthLabel"), "width", item?.width ?? 1.8, { type: "number", min: 0.5, max: 20 }),
      field(t("table.lengthLabel"), "height", item?.height ?? 1.8, { type: "number", min: 0.5, max: 20 }));
    fields.append(row, field(t("table.orientationLabel"), "rotation", item?.rotation ?? 0, { choices: [["0", t("table.horizontal")], ["90", t("table.vertical")]] }),
      element("p", "helper", t("table.sizeHelp")));
    const syncShape = () => {
      const round = $("field-shape").value === "round";
      for (const name of ["height", "rotation"]) {
        $(`field-${name}`).disabled = round;
        $(`field-${name}`).closest(".field").hidden = round;
      }
      row.style.gridTemplateColumns = round ? "1fr" : "";
      $("field-width").labels[0].textContent = t(round ? "table.diameterLabel" : "table.widthLabel");
    };
    $("field-shape").addEventListener("change", syncShape);
    syncShape();
  }
  $("editor-dialog").showModal();
}

$("editor-form").addEventListener("submit", event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const next = structuredClone(plan);
  const name = String(values.get("name")).trim();
  let newRoomId = activeRoomId;
  let newTableId = selectedTableId;
  try {
    if (editor.kind === "venue") {
      next.name = name;
    } else if (editor.kind === "room") {
      const room = { id: editor.id ?? uid(), name, width: Number(values.get("width")), height: Number(values.get("height")) };
      if (editor.id) next.rooms[next.rooms.findIndex(item => item.id === editor.id)] = room;
      else next.rooms.push(room);
      if (next.rooms.length > LIMITS.rooms) throw new Error(t("room.limit", { max: LIMITS.rooms }));
      for (const table of next.tables.filter(item => item.roomId === room.id)) {
        const size = tableSize(table);
        if (size.width > room.width || size.height > room.height) throw new Error(t("room.tableTooLarge", { table: table.name }));
        Object.assign(table, clampPosition(table, room, table.x, table.y));
      }
      newRoomId = room.id;
    } else {
      const existing = next.tables.find(item => item.id === editor.id);
      const shape = values.get("shape");
      const width = Number(values.get("width"));
      const table = {
        id: editor.id ?? uid(), roomId: activeRoomId, name, shape, width,
        height: shape === "round" ? width : Number(values.get("height")),
        rotation: shape === "round" ? 0 : Number(values.get("rotation")),
        capacity: Number(values.get("capacity")), x: existing?.x ?? 1, y: existing?.y ?? 1,
      };
      Object.assign(table, clampPosition(table, currentRoom(), table.x, table.y));
      if (existing) next.tables[next.tables.findIndex(item => item.id === table.id)] = table;
      else next.tables.push(table);
      newTableId = table.id;
    }
    const valid = validatePlan(next);
    activeRoomId = newRoomId;
    selectedTableId = newTableId;
    commit(valid);
    $("editor-dialog").close();
  } catch (error) {
    $("dialog-error").textContent = errorMessage(error);
    $("dialog-error").hidden = false;
  }
});

$("delete-item").addEventListener("click", () => {
  const room = editor.kind === "room";
  if (!confirm(t(room ? "room.deleteConfirm" : "table.deleteConfirm"))) return;
  const next = structuredClone(plan);
  if (room) removeRoom(next, editor.id);
  else removeTable(next, editor.id);
  commit(next);
  $("editor-dialog").close();
});
for (const id of ["close-dialog", "cancel-dialog"]) $(id).addEventListener("click", () => $("editor-dialog").close());
$("rename-venue").addEventListener("click", () => openEditor("venue"));
$("new-plan-button").addEventListener("click", () => {
  if (!confirm(t("plan.newConfirm"))) return;
  activeRoomId = null;
  selectedTableId = null;
  $("guest-search").value = "";
  $("unseated-only").checked = false;
  $("guest-names").value = "";
  commit(createPlan(t("plan.defaultName")));
  notify(t("plan.created"));
});
$("add-room").addEventListener("click", () => openEditor("room"));
$("add-table").addEventListener("click", () => openEditor("table"));
$("edit-room").addEventListener("click", () => openEditor("room", activeRoomId));
$("guest-search").addEventListener("input", renderGuests);
$("unseated-only").addEventListener("change", renderGuests);
const planningTabs = Array.from($("planning-tabs").querySelectorAll('[role="tab"]'));
for (const tab of planningTabs) {
  tab.addEventListener("click", () => selectPlanningTab(tab));
  tab.addEventListener("keydown", event => {
    const index = planningTabs.indexOf(tab);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % planningTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + planningTabs.length) % planningTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = planningTabs.length - 1;
    else return;
    event.preventDefault();
    selectPlanningTab(planningTabs[nextIndex]);
    planningTabs[nextIndex].focus();
  });
}
$("group-search").addEventListener("input", renderGroups);
$("linked-only").addEventListener("change", renderGroups);
makeGroupDropTarget($("group-unlink-drop"), null);
$("guest-form").addEventListener("submit", event => {
  event.preventDefault();
  const names = $("guest-names").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (!names.length) { notify(t("guests.enterName"), true); return; }
  if (plan.guests.length + names.length > LIMITS.guests) { notify(t("guests.limit", { max: LIMITS.guests }), true); return; }
  try {
    const next = structuredClone(plan);
    next.guests.push(...names.map(name => ({ id: uid(), name, tableId: null })));
    commit(next);
    $("guest-names").value = "";
    notify(t("guests.added", { count: names.length }));
  } catch (error) { notify(errorMessage(error), true); }
});

$("export-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = element("a");
  anchor.href = url;
  anchor.download = `${plan.name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 70) || "venue"}-seating-plan.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(t("plan.exported"));
});
$("import-button").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error(t("plan.importTooLarge"));
    const imported = validatePlan(JSON.parse(await file.text()));
    if (!confirm(t("plan.importConfirm", { name: imported.name }))) return;
    activeRoomId = imported.rooms[0]?.id ?? null;
    selectedTableId = null;
    $("guest-search").value = "";
    $("unseated-only").checked = false;
    commit(imported);
    notify(t("plan.imported"));
  } catch (error) {
    notify(t("plan.importFailed", { message: errorMessage(error) }), true);
  } finally { event.target.value = ""; }
});

function renderPrint() {
  const output = $("print-plan");
  output.replaceChildren();
  for (const room of plan.rooms) {
    const section = element("section", "print-room");
    section.append(element("h1", "", plan.name), element("h2", "", room.name),
      element("p", "", t("room.dimensions", { width: room.width, height: room.height })));
    const canvas = element("div", "room-canvas");
    canvas.style.aspectRatio = `${room.width} / ${room.height}`;
    const tables = plan.tables.filter(table => table.roomId === room.id);
    for (const table of tables) canvas.append(makeTable(table, room, false));
    section.append(canvas);
    for (const table of tables) {
      const guests = plan.guests.filter(guest => guest.tableId === table.id);
      const block = element("div", "print-table");
      block.append(element("h3", "", t("print.tableHeading", { name: table.name, count: guests.length, capacity: table.capacity })),
        element("p", "", guests.length ? guests.map(guest => guest.name).join(", ") : t("print.noGuests")));
      section.append(block);
    }
    output.append(section);
  }
  const unseated = plan.guests.filter(guest => guest.tableId === null);
  if (unseated.length || !plan.rooms.length) {
    const section = element("section", "print-room");
    section.append(element("h1", "", plan.name), element("h2", "", t("print.unseated", { count: unseated.length })),
      element("p", "", unseated.map(guest => guest.name).join(", ") || t("print.nothing")));
    output.append(section);
  }
}
function fullscreenActive() {
  return document.fullscreenElement === $("workspace") || $("workspace").classList.contains("pseudo-fullscreen");
}

function syncFullscreenButton() {
  const active = fullscreenActive();
  $("fullscreen-button").textContent = t(active ? "fullscreen.exit" : "fullscreen.enter");
  $("fullscreen-button").setAttribute("aria-pressed", String(active));
  document.body.classList.toggle("workspace-expanded", $("workspace").classList.contains("pseudo-fullscreen"));
}

async function toggleFullscreen() {
  const workspace = $("workspace");
  if (fullscreenActive()) {
    workspace.classList.remove("pseudo-fullscreen");
    if (document.fullscreenElement) await document.exitFullscreen();
  } else if (document.fullscreenEnabled && workspace.requestFullscreen) {
    try { await workspace.requestFullscreen(); }
    catch { workspace.classList.add("pseudo-fullscreen"); }
  } else {
    workspace.classList.add("pseudo-fullscreen");
  }
  syncFullscreenButton();
}

$("fullscreen-button").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncFullscreenButton);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("workspace").classList.contains("pseudo-fullscreen") && !$("editor-dialog").open) toggleFullscreen();
});
window.addEventListener("beforeprint", renderPrint);
document.addEventListener("click", event => {
  if (event.target.closest(".seat")) return;
  for (const seat of document.querySelectorAll(".seat.revealed")) seat.classList.remove("revealed");
});
$("print-button").addEventListener("click", () => { renderPrint(); window.print(); });

const languageSelect = $("language-select");
for (const { code, name } of GatherI18n.available()) languageSelect.append(new Option(name, code));
languageSelect.value = GatherI18n.locale;
languageSelect.addEventListener("change", () => {
  GatherI18n.setLocale(languageSelect.value);
  setSaveStatus(saveStatusKey);
  syncFullscreenButton();
  if (editor && $("editor-dialog").open) $("editor-dialog").close();
  render();
});
setSaveStatus(saveStatusKey);
render();
})();
