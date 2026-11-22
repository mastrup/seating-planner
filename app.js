(function () {
const { STORAGE_KEY, LIMITS, createPlan, validatePlan, tableSize, clampPosition, occupancy, assignGuest, linkGuests, unlinkGuest, moveGuestToSeat, removeTable, removeRoom } = globalThis.GatherModel;

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
let plan = createPlan();
let activeRoomId = null;
let selectedTableId = null;
let editor = null;
let notificationTimer;

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
  $("save-status").textContent = "Saved plan could not be loaded";
  notify(`Could not load browser data: ${error.message} Export your work before leaving.`, true);
}
activeRoomId = plan.rooms[0]?.id ?? null;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    $("save-status").textContent = "Saved in this browser";
  } catch (error) {
    $("save-status").textContent = "Not saved - export a backup";
    notify(`Browser save failed: ${error.message} Please export your plan to keep your changes.`, true);
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
  document.title = `${plan.name} - Gather`;
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
  $("room-title").textContent = room?.name ?? "Create your first room";
  const roomTableCount = plan.tables.filter(table => table.roomId === room?.id).length;
  $("room-dimensions").textContent = room ? `${room.width} m wide x ${room.height} m long · ${roomTableCount} ${roomTableCount === 1 ? "table" : "tables"}` : "Start with the space, then add your tables.";
  const canvas = $("room-canvas");
  if (!room) {
    canvas.style.aspectRatio = "1.5";
    canvas.replaceChildren();
    const empty = element("div", "canvas-empty");
    empty.append(element("span", "empty-icon", "+"), element("h3", "", "Good gatherings start here"), element("p", "", "Add a room to start planning your venue."));
    const button = element("button", "primary", "Create a room");
    button.addEventListener("click", () => openEditor("room"));
    empty.append(button);
    canvas.append(empty);
    return;
  }
  canvas.style.aspectRatio = `${room.width} / ${room.height}`;
  canvas.setAttribute("aria-label", `${room.name} floor plan, ${room.width} by ${room.height} meters`);
  canvas.replaceChildren();
  const tables = plan.tables.filter(table => table.roomId === room.id);
  if (!tables.length) {
    const empty = element("div", "canvas-empty");
    empty.append(element("span", "empty-icon", "+"), element("h3", "", "Make room for your guests"), element("p", "", "Add a round or rectangular table to this room."));
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
  node.setAttribute("aria-label", `${table.name}, ${count} of ${table.capacity} seats occupied. Use arrow keys to move, Enter to select.`);
  node.title = `${table.name} · ${count}/${table.capacity} seated · Arrow keys to move (Shift for larger steps)`;
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
    seat.setAttribute("aria-label", `${guest.name}, seat ${index + 1} of ${guests.length} at ${table.name}. Drag, or use arrow keys, to change the seating order.`);
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
    notify(error.message, true);
    renderGuests();
  }
}

function renderGuests() {
  const list = $("guest-list");
  list.replaceChildren();
  const query = $("guest-search").value.toLocaleLowerCase();
  const guests = plan.guests.filter(guest => guest.name.toLocaleLowerCase().includes(query) && (!$("unseated-only").checked || guest.tableId === null));
  if (!guests.length) list.append(element("p", "empty-list", plan.guests.length ? "No guests match your filters." : "Your guest list is waiting. Add a name or paste your whole list above."));
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
    remove.setAttribute("aria-label", `Remove ${guest.name}`);
    remove.addEventListener("click", () => {
      if (!confirm(`Remove ${guest.name} from the guest list?`)) return;
      const next = structuredClone(plan);
      next.guests = next.guests.filter(item => item.id !== guest.id);
      commit(next);
    });
    const nameLabel = element("span", "guest-name", guest.name);
    const rename = element("button", "icon-button rename-button", "\u270E");
    rename.type = "button";
    rename.setAttribute("aria-label", `Rename ${guest.name}`);
    rename.title = "Rename";
    const startRename = () => {
      const input = element("input", "rename-input");
      input.value = guest.name;
      input.maxLength = 100;
      input.setAttribute("aria-label", `New name for ${guest.name}`);
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
          notify(error.message, true);
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
    select.setAttribute("aria-label", `Table for ${guest.name}`);
    select.append(new Option("Unseated", ""));
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
    row.append(element("span", "link-names", `\u{1F517} Seated with ${group.filter(item => item !== guest).map(item => item.name).join(", ")}`));
    const unlink = element("button", "link-button", "Unlink");
    unlink.type = "button";
    unlink.setAttribute("aria-label", `Unlink ${guest.name}`);
    unlink.addEventListener("click", () => {
      const next = structuredClone(plan);
      unlinkGuest(next, guest.id);
      commit(next);
    });
    row.append(unlink);
  }
  const picker = element("select", "link-select");
  picker.setAttribute("aria-label", `Link ${guest.name} with another guest`);
  picker.append(new Option(group.length > 1 ? "Add another link\u2026" : "Link with\u2026", ""));
  for (const other of plan.guests) if (!group.includes(other)) picker.append(new Option(other.name, other.id));
  picker.addEventListener("change", () => {
    if (!picker.value) return;
    try {
      const next = structuredClone(plan);
      linkGuests(next, guest.id, picker.value);
      commit(next);
      notify(`${guest.name} will always be seated with the linked guests.`);
    } catch (error) {
      notify(error.message, true);
      renderGuests();
    }
  });
  row.append(picker);
  return row;
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
  title.append(element("h3", "", table.name), element("p", "helper", `${guests.length} of ${table.capacity} seats occupied · ${table.width} x ${table.height} m`));
  const edit = element("button", "", "Edit table");
  edit.addEventListener("click", () => openEditor("table", table.id));
  heading.append(title, edit);
  details.append(heading);
  const chips = element("div", "assigned-guests");
  if (!guests.length) chips.append(element("p", "muted", "No guests yet. Assign someone from the guest list."));
  else details.append(element("p", "helper", "Seats run clockwise from the top of the table. Drag a name or use the arrows to change the order. You can also drag the initials around the table."));
  guests.forEach((guest, index) => {
    const chip = element("span", "guest-chip");
    chip.draggable = true;
    chip.dataset.guestId = guest.id;
    chip.append(element("span", "chip-number", String(index + 1)), element("span", "", guest.name));
    const reorder = (label, glyph, target) => {
      const button = element("button", "icon-button", glyph);
      button.type = "button";
      button.setAttribute("aria-label", `${label} ${guest.name}`);
      button.disabled = target < 0 || target >= guests.length;
      button.addEventListener("click", () => moveSeat(guest.id, target, true));
      return button;
    };
    const remove = element("button", "icon-button", "\u00d7");
    remove.setAttribute("aria-label", `Unseat ${guest.name}`);
    remove.addEventListener("click", () => changeAssignment(guest.id, null));
    chip.append(reorder("Move earlier:", "\u25c0", index - 1), reorder("Move later:", "\u25b6", index + 1), remove);
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
  } catch (error) { notify(error.message, true); }
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
    $("dialog-title").textContent = "Name your venue";
    fields.append(field("Venue name", "name", plan.name));
  } else if (kind === "room") {
    const item = plan.rooms.find(value => value.id === id);
    $("dialog-title").textContent = item ? "Edit room" : "Create a room";
    fields.append(field("Room name", "name", item?.name ?? `Room ${plan.rooms.length + 1}`));
    const row = element("div", "field-row");
    row.append(field("Width (meters)", "width", item?.width ?? 12, { type: "number", min: 2, max: 100 }),
      field("Length (meters)", "height", item?.height ?? 8, { type: "number", min: 2, max: 100 }));
    fields.append(row, element("p", "helper", "Rooms can be 2-100 meters in each direction. Tables are kept within the room when you resize it."));
  } else {
    if (!room) return;
    const item = plan.tables.find(value => value.id === id);
    $("dialog-title").textContent = item ? "Edit table" : "Add a table";
    fields.append(field("Table name", "name", item?.name ?? `Table ${plan.tables.length + 1}`),
      field("Shape", "shape", item?.shape ?? "round", { choices: [["round", "Round"], ["rectangle", "Rectangular"]] }),
      field("Seats", "capacity", item?.capacity ?? 8, { type: "number", min: 1, max: 100, step: 1 }));
    const row = element("div", "field-row");
    row.append(field("Width (m)", "width", item?.width ?? 1.8, { type: "number", min: 0.5, max: 20 }),
      field("Length (meters)", "height", item?.height ?? 1.8, { type: "number", min: 0.5, max: 20 }));
    fields.append(row, field("Orientation", "rotation", item?.rotation ?? 0, { choices: [["0", "Horizontal (0 degrees)"], ["90", "Vertical (90 degrees)"]] }),
      element("p", "helper", "Round tables are sized by their diameter. Tables must fit inside the room. Overlap is allowed so you can arrange tables together."));
    const syncShape = () => {
      const round = $("field-shape").value === "round";
      for (const name of ["height", "rotation"]) {
        $(`field-${name}`).disabled = round;
        $(`field-${name}`).closest(".field").hidden = round;
      }
      row.style.gridTemplateColumns = round ? "1fr" : "";
      $("field-width").labels[0].textContent = round ? "Diameter (m)" : "Width (m)";
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
      if (next.rooms.length > LIMITS.rooms) throw new Error(`You can create up to ${LIMITS.rooms} rooms.`);
      for (const table of next.tables.filter(item => item.roomId === room.id)) {
        const size = tableSize(table);
        if (size.width > room.width || size.height > room.height) throw new Error(`${table.name} is too large for this room. Resize the table first.`);
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
    $("dialog-error").textContent = error.message;
    $("dialog-error").hidden = false;
  }
});

$("delete-item").addEventListener("click", () => {
  const room = editor.kind === "room";
  if (!confirm(room ? "Delete this room and all its tables? Its guests will become unseated." : "Delete this table? Its guests will become unseated.")) return;
  const next = structuredClone(plan);
  if (room) removeRoom(next, editor.id);
  else removeTable(next, editor.id);
  commit(next);
  $("editor-dialog").close();
});
for (const id of ["close-dialog", "cancel-dialog"]) $(id).addEventListener("click", () => $("editor-dialog").close());
$("rename-venue").addEventListener("click", () => openEditor("venue"));
$("add-room").addEventListener("click", () => openEditor("room"));
$("add-table").addEventListener("click", () => openEditor("table"));
$("edit-room").addEventListener("click", () => openEditor("room", activeRoomId));
$("guest-search").addEventListener("input", renderGuests);
$("unseated-only").addEventListener("change", renderGuests);
$("guest-form").addEventListener("submit", event => {
  event.preventDefault();
  const names = $("guest-names").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (!names.length) { notify("Enter at least one guest name.", true); return; }
  if (plan.guests.length + names.length > LIMITS.guests) { notify(`You can add up to ${LIMITS.guests} guests.`, true); return; }
  try {
    const next = structuredClone(plan);
    next.guests.push(...names.map(name => ({ id: uid(), name, tableId: null })));
    commit(next);
    $("guest-names").value = "";
    notify(`${names.length} ${names.length === 1 ? "guest" : "guests"} added.`);
  } catch (error) { notify(error.message, true); }
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
  notify("Plan exported. Keep this file as a backup.");
});
$("import-button").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("The plan file must be smaller than 5 MB.");
    const imported = validatePlan(JSON.parse(await file.text()));
    if (!confirm(`Replace the current plan with "${imported.name}"? Export your current plan first if you want to keep it.`)) return;
    activeRoomId = imported.rooms[0]?.id ?? null;
    selectedTableId = null;
    $("guest-search").value = "";
    $("unseated-only").checked = false;
    commit(imported);
    notify("Plan imported.");
  } catch (error) {
    notify(`Import failed: ${error.message} Your current plan has not been changed.`, true);
  } finally { event.target.value = ""; }
});

function renderPrint() {
  const output = $("print-plan");
  output.replaceChildren();
  for (const room of plan.rooms) {
    const section = element("section", "print-room");
    section.append(element("h1", "", plan.name), element("h2", "", room.name),
      element("p", "", `${room.width} m wide x ${room.height} m long`));
    const canvas = element("div", "room-canvas");
    canvas.style.aspectRatio = `${room.width} / ${room.height}`;
    const tables = plan.tables.filter(table => table.roomId === room.id);
    for (const table of tables) canvas.append(makeTable(table, room, false));
    section.append(canvas);
    for (const table of tables) {
      const guests = plan.guests.filter(guest => guest.tableId === table.id);
      const block = element("div", "print-table");
      block.append(element("h3", "", `${table.name} (${guests.length}/${table.capacity} seats)`),
        element("p", "", guests.length ? guests.map(guest => guest.name).join(", ") : "No guests assigned"));
      section.append(block);
    }
    output.append(section);
  }
  const unseated = plan.guests.filter(guest => guest.tableId === null);
  if (unseated.length || !plan.rooms.length) {
    const section = element("section", "print-room");
    section.append(element("h1", "", plan.name), element("h2", "", `Unseated guests (${unseated.length})`),
      element("p", "", unseated.map(guest => guest.name).join(", ") || "No rooms or guests yet."));
    output.append(section);
  }
}
function fullscreenActive() {
  return document.fullscreenElement === $("workspace") || $("workspace").classList.contains("pseudo-fullscreen");
}

function syncFullscreenButton() {
  const active = fullscreenActive();
  $("fullscreen-button").textContent = active ? "Exit full screen" : "Full screen";
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
render();
})();
