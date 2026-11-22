// Classic script (no ES modules) so the app also works when opened from file://.
(function () {
const STORAGE_KEY = "gather.seating-plan.v1";
const LIMITS = { rooms: 50, tables: 500, guests: 5000 };

function createPlan() {
  return { version: 1, name: "Your venue", rooms: [], tables: [], guests: [] };
}

function tableSize(table) {
  return table.rotation === 90
    ? { width: table.height, height: table.width }
    : { width: table.width, height: table.height };
}

function clampPosition(table, room, x, y) {
  const size = tableSize(table);
  return {
    x: Math.max(0, Math.min(x, room.width - size.width)),
    y: Math.max(0, Math.min(y, room.height - size.height)),
  };
}

function occupancy(plan, tableId) {
  return plan.guests.filter(guest => guest.tableId === tableId).length;
}

function linkedGroup(plan, guest) {
  return guest.linkId ? plan.guests.filter(item => item.linkId === guest.linkId) : [guest];
}

// Moves a guest together with everyone linked to them.
function assignGuest(plan, guestId, tableId) {
  const guest = plan.guests.find(item => item.id === guestId);
  if (!guest) throw new Error("This guest no longer exists.");
  const group = linkedGroup(plan, guest);
  if (tableId !== null) {
    const table = plan.tables.find(item => item.id === tableId);
    if (!table) throw new Error("This table no longer exists.");
    const incoming = group.filter(item => item.tableId !== tableId).length;
    if (occupancy(plan, tableId) + incoming > table.capacity) {
      throw new Error(group.length > 1
        ? `${table.name} does not have room for all ${group.length} linked guests.`
        : `${table.name} is full. Choose another table or increase its capacity.`);
    }
  }
  for (const member of group) member.tableId = tableId;
}

// Links two guests (merging their groups) and seats the whole group together at the first guest's table.
function linkGuests(plan, guestId, otherId) {
  const guest = plan.guests.find(item => item.id === guestId);
  const other = plan.guests.find(item => item.id === otherId);
  if (!guest || !other) throw new Error("This guest no longer exists.");
  if (guest === other) throw new Error("Choose a different guest to link with.");
  if (guest.linkId && guest.linkId === other.linkId) return;
  const members = [...linkedGroup(plan, guest), ...linkedGroup(plan, other)];
  const linkId = guest.linkId || `link-${guest.id}`;
  const target = guest.tableId ?? members.find(item => item.tableId !== null)?.tableId ?? null;
  for (const member of members) member.linkId = linkId;
  assignGuest(plan, guest.id, target);
}

function unlinkGuest(plan, guestId) {
  const guest = plan.guests.find(item => item.id === guestId);
  if (guest) delete guest.linkId;
}

// Seat order is the order of a table's guests within plan.guests.
function moveGuestToSeat(plan, guestId, seatIndex) {
  const guest = plan.guests.find(item => item.id === guestId);
  if (!guest || guest.tableId === null) throw new Error("This guest is not seated at a table.");
  const slots = [];
  plan.guests.forEach((item, index) => { if (item.tableId === guest.tableId) slots.push(index); });
  const seated = slots.map(index => plan.guests[index]);
  seated.splice(seated.indexOf(guest), 1);
  seated.splice(Math.max(0, Math.min(seatIndex, seated.length)), 0, guest);
  slots.forEach((slot, index) => { plan.guests[slot] = seated[index]; });
}

function removeTable(plan, tableId) {
  plan.tables = plan.tables.filter(table => table.id !== tableId);
  for (const guest of plan.guests) if (guest.tableId === tableId) guest.tableId = null;
}

function removeRoom(plan, roomId) {
  for (const table of plan.tables.filter(item => item.roomId === roomId)) removeTable(plan, table.id);
  plan.rooms = plan.rooms.filter(room => room.id !== roomId);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function text(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must contain 1-${max} characters.`);
  }
  return value.trim();
}

function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  }
  return value;
}

function validatePlan(input) {
  object(input, "Plan");
  if (input.version !== 1) throw new Error("Unsupported plan format. Import a Gather version 1 JSON export.");
  const plan = { version: 1, name: text(input.name, "Venue name"), rooms: [], tables: [], guests: [] };
  const ids = new Set();
  const id = (value, label) => {
    const result = text(value, `${label} ID`, 100);
    if (ids.has(result)) throw new Error(`Duplicate ID: ${result}.`);
    ids.add(result);
    return result;
  };
  for (const collection of ["rooms", "tables", "guests"]) {
    if (!Array.isArray(input[collection]) || input[collection].length > LIMITS[collection]) {
      throw new Error(`Plan must contain a ${collection} array with at most ${LIMITS[collection]} entries.`);
    }
  }
  for (const room of input.rooms) {
    object(room, "Room");
    plan.rooms.push({
      id: id(room.id, "Room"), name: text(room.name, "Room name"),
      width: number(room.width, "Room width", 2, 100),
      height: number(room.height, "Room length", 2, 100),
    });
  }
  const rooms = new Map(plan.rooms.map(room => [room.id, room]));
  for (const table of input.tables) {
    object(table, "Table");
    if (!rooms.has(table.roomId)) throw new Error("A table refers to a missing room.");
    if (!["round", "rectangle"].includes(table.shape)) throw new Error("Table shape must be round or rectangle.");
    if (![0, 90].includes(table.rotation)) throw new Error("Table rotation must be 0 or 90 degrees.");
    const item = {
      id: id(table.id, "Table"), roomId: table.roomId, name: text(table.name, "Table name"),
      shape: table.shape, capacity: number(table.capacity, "Table capacity", 1, 100, true),
      width: number(table.width, "Table width", 0.5, 20),
      height: number(table.height, "Table length", 0.5, 20),
      x: number(table.x, "Table X position", 0, 100),
      y: number(table.y, "Table Y position", 0, 100), rotation: table.rotation,
    };
    if (item.shape === "round" && item.width !== item.height) throw new Error("Round tables must have equal width and length.");
    const room = rooms.get(item.roomId);
    const size = tableSize(item);
    if (item.x + size.width > room.width + 1e-8 || item.y + size.height > room.height + 1e-8) {
      throw new Error(`${item.name} must fit inside its room.`);
    }
    plan.tables.push(item);
  }
  const tables = new Map(plan.tables.map(table => [table.id, table]));
  const counts = new Map();
  for (const guest of input.guests) {
    object(guest, "Guest");
    if (guest.tableId !== null && !tables.has(guest.tableId)) throw new Error("A guest refers to a missing table.");
    const item = { id: id(guest.id, "Guest"), name: text(guest.name, "Guest name"), tableId: guest.tableId };
    if (guest.linkId !== undefined) item.linkId = text(guest.linkId, "Link ID", 120);
    plan.guests.push(item);
    if (guest.tableId !== null) counts.set(guest.tableId, (counts.get(guest.tableId) || 0) + 1);
  }
  // A link needs at least two guests.
  const linkSizes = new Map();
  for (const guest of plan.guests) if (guest.linkId) linkSizes.set(guest.linkId, (linkSizes.get(guest.linkId) || 0) + 1);
  for (const guest of plan.guests) if (guest.linkId && linkSizes.get(guest.linkId) < 2) delete guest.linkId;
  for (const [tableId, count] of counts) {
    if (count > tables.get(tableId).capacity) throw new Error(`${tables.get(tableId).name} has more guests than seats.`);
  }
  return plan;
}

const api = { STORAGE_KEY, LIMITS, createPlan, validatePlan, tableSize, clampPosition, occupancy, assignGuest, linkGuests, unlinkGuest, moveGuestToSeat, removeTable, removeRoom };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.GatherModel = api;
})();
