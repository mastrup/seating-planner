// Classic script (no ES modules) so the app also works when opened from file://.
(function () {
const STORAGE_KEY = "gather.seating-plan.v1";
const LIMITS = { rooms: 50, tables: 500, guests: 5000 };

// English labels used in error messages; the UI translates them through the "label.<key>" keys.
const LABELS = {
  plan: "Plan", groupName: "Group name", groupNames: "Group names", venueName: "Venue name",
  room: "Room", roomName: "Room name", roomWidth: "Room width", roomLength: "Room length", roomId: "Room ID",
  table: "Table", tableName: "Table name", tableCapacity: "Table capacity", tableWidth: "Table width",
  tableLength: "Table length", tableX: "Table X position", tableY: "Table Y position", tableId: "Table ID",
  guest: "Guest", guestName: "Guest name", guestId: "Guest ID", linkId: "Link ID",
  rooms: "rooms", tables: "tables", guests: "guests",
};

// Errors keep an English message (for tests and logs) and an i18n key the UI can translate.
function fail(key, params, message) {
  const error = new Error(message);
  error.i18n = { key, params };
  return error;
}

function createPlan(name = "Your venue") {
  return { version: 1, name, rooms: [], tables: [], guests: [], groupNames: {} };
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
  if (!guest) throw fail("err.guestGone", {}, "This guest no longer exists.");
  const group = linkedGroup(plan, guest);
  if (tableId !== null) {
    const table = plan.tables.find(item => item.id === tableId);
    if (!table) throw fail("err.tableGone", {}, "This table no longer exists.");
    const incoming = group.filter(item => item.tableId !== tableId).length;
    if (occupancy(plan, tableId) + incoming > table.capacity) {
      throw group.length > 1
        ? fail("err.groupNoRoom", { table: table.name, count: group.length }, `${table.name} does not have room for all ${group.length} linked guests.`)
        : fail("err.tableFull", { table: table.name }, `${table.name} is full. Choose another table or increase its capacity.`);
    }
  }
  for (const member of group) member.tableId = tableId;
}

// Links two guests (merging their groups) and seats the whole group together at the first guest's table.
function linkGuests(plan, guestId, otherId) {
  const guest = plan.guests.find(item => item.id === guestId);
  const other = plan.guests.find(item => item.id === otherId);
  if (!guest || !other) throw fail("err.guestGone", {}, "This guest no longer exists.");
  if (guest === other) throw fail("err.linkSelf", {}, "Choose a different guest to link with.");
  if (guest.linkId && guest.linkId === other.linkId) return;
  const members = [...linkedGroup(plan, guest), ...linkedGroup(plan, other)];
  const previousIds = [guest.linkId, other.linkId];
  const groupName = plan.groupNames?.[previousIds[0]] ?? plan.groupNames?.[previousIds[1]];
  const linkId = guest.linkId || `link-${guest.id}`;
  const target = guest.tableId ?? members.find(item => item.tableId !== null)?.tableId ?? null;
  for (const member of members) member.linkId = linkId;
  plan.groupNames ??= {};
  for (const previousId of previousIds) {
    if (previousId && previousId !== linkId) delete plan.groupNames[previousId];
  }
  if (groupName) plan.groupNames[linkId] = groupName;
  assignGuest(plan, guest.id, target);
}

function unlinkGuest(plan, guestId) {
  const guest = plan.guests.find(item => item.id === guestId);
  if (!guest) return;
  const previousId = guest.linkId;
  delete guest.linkId;
  if (previousId && plan.guests.filter(item => item.linkId === previousId).length < 2) {
    delete plan.groupNames?.[previousId];
  }
}

function renameGroup(plan, linkId, name) {
  if (plan.guests.filter(guest => guest.linkId === linkId).length < 2) {
    throw fail("err.groupGone", {}, "This group no longer exists.");
  }
  plan.groupNames ??= {};
  plan.groupNames[linkId] = text(name, "groupName");
}

function moveGuestToGroup(plan, guestId, targetId) {
  const guest = plan.guests.find(item => item.id === guestId);
  const target = plan.guests.find(item => item.id === targetId);
  if (!guest || !target) throw fail("err.guestGone", {}, "This guest no longer exists.");
  if (guest === target || (guest.linkId && guest.linkId === target.linkId)) return;
  if (target.tableId !== null) {
    const table = plan.tables.find(item => item.id === target.tableId);
    if (!table) throw fail("err.tableGone", {}, "This table no longer exists.");
    if (occupancy(plan, table.id) + Number(guest.tableId !== table.id) > table.capacity) {
      throw fail("err.tableFull", { table: table.name }, `${table.name} is full. Choose another table or increase its capacity.`);
    }
  }
  const previousGroup = guest.linkId;
  let linkId = target.linkId;
  if (!linkId) {
    const base = `link-${target.id}`;
    linkId = base;
    let suffix = 1;
    while (plan.guests.some(item => item.linkId === linkId)) linkId = `${base}-${suffix++}`;
  }
  guest.linkId = target.linkId = linkId;
  guest.tableId = target.tableId;
  if (previousGroup) {
    const remaining = plan.guests.filter(item => item.linkId === previousGroup);
    if (remaining.length === 1) {
      delete remaining[0].linkId;
      delete plan.groupNames?.[previousGroup];
    }
  }
}

// Seat order is the order of a table's guests within plan.guests.
function moveGuestToSeat(plan, guestId, seatIndex) {
  const guest = plan.guests.find(item => item.id === guestId);
  if (!guest || guest.tableId === null) throw fail("err.notSeated", {}, "This guest is not seated at a table.");
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
  if (!value || typeof value !== "object" || Array.isArray(value))   throw fail("err.notObject", { label }, `${LABELS[label]} must be an object.`);
}

function text(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
      throw fail("err.textLength", { label, max }, `${LABELS[label]} must contain 1-${max} characters.`);
  }
  return value.trim();
}

function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw fail(integer ? "err.wholeNumberRange" : "err.numberRange", { label, min, max },
        `${LABELS[label]} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  }
  return value;
}

function validatePlan(input) {
    object(input, "plan");
    if (input.version !== 1) throw fail("err.unsupportedFormat", {}, "Unsupported plan format. Import a Gather version 1 JSON export.");
    const plan = { version: 1, name: text(input.name, "venueName"), rooms: [], tables: [], guests: [], groupNames: {} };
  const groupNames = input.groupNames === undefined ? {} : input.groupNames;
    object(groupNames, "groupNames");
  const ids = new Set();
  const id = (value, label) => {
      const result = text(value, `${label}Id`, 100);
      if (ids.has(result)) throw fail("err.duplicateId", { id: result }, `Duplicate ID: ${result}.`);
    ids.add(result);
    return result;
  };
  for (const collection of ["rooms", "tables", "guests"]) {
    if (!Array.isArray(input[collection]) || input[collection].length > LIMITS[collection]) {
        throw fail("err.badCollection", { label: collection, max: LIMITS[collection] },
          `Plan must contain a ${collection} array with at most ${LIMITS[collection]} entries.`);
    }
  }
  for (const room of input.rooms) {
      object(room, "room");
    plan.rooms.push({
        id: id(room.id, "room"), name: text(room.name, "roomName"),
        width: number(room.width, "roomWidth", 2, 100),
        height: number(room.height, "roomLength", 2, 100),
    });
  }
  const rooms = new Map(plan.rooms.map(room => [room.id, room]));
  for (const table of input.tables) {
      object(table, "table");
      if (!rooms.has(table.roomId)) throw fail("err.tableMissingRoom", {}, "A table refers to a missing room.");
      if (!["round", "rectangle"].includes(table.shape)) throw fail("err.badShape", {}, "Table shape must be round or rectangle.");
      if (![0, 90].includes(table.rotation)) throw fail("err.badRotation", {}, "Table rotation must be 0 or 90 degrees.");
    const item = {
        id: id(table.id, "table"), roomId: table.roomId, name: text(table.name, "tableName"),
        shape: table.shape, capacity: number(table.capacity, "tableCapacity", 1, 100, true),
        width: number(table.width, "tableWidth", 0.5, 20),
        height: number(table.height, "tableLength", 0.5, 20),
        x: number(table.x, "tableX", 0, 100),
        y: number(table.y, "tableY", 0, 100), rotation: table.rotation,
    };
      if (item.shape === "round" && item.width !== item.height) throw fail("err.roundEqual", {}, "Round tables must have equal width and length.");
    const room = rooms.get(item.roomId);
    const size = tableSize(item);
    if (item.x + size.width > room.width + 1e-8 || item.y + size.height > room.height + 1e-8) {
        throw fail("err.fitInside", { table: item.name }, `${item.name} must fit inside its room.`);
    }
    plan.tables.push(item);
  }
  const tables = new Map(plan.tables.map(table => [table.id, table]));
  const counts = new Map();
  for (const guest of input.guests) {
      object(guest, "guest");
      if (guest.tableId !== null && !tables.has(guest.tableId)) throw fail("err.guestMissingTable", {}, "A guest refers to a missing table.");
      const item = { id: id(guest.id, "guest"), name: text(guest.name, "guestName"), tableId: guest.tableId };
      if (guest.linkId !== undefined) item.linkId = text(guest.linkId, "linkId", 120);
    plan.guests.push(item);
    if (guest.tableId !== null) counts.set(guest.tableId, (counts.get(guest.tableId) || 0) + 1);
  }
  // A link needs at least two guests.
  const linkSizes = new Map();
  for (const guest of plan.guests) if (guest.linkId) linkSizes.set(guest.linkId, (linkSizes.get(guest.linkId) || 0) + 1);
  for (const guest of plan.guests) if (guest.linkId && linkSizes.get(guest.linkId) < 2) delete guest.linkId;
  const linkedIds = new Set(plan.guests.filter(guest => guest.linkId).map(guest => guest.linkId));
  for (const [linkId, name] of Object.entries(groupNames)) {
    if (linkedIds.has(linkId)) plan.groupNames[linkId] = text(name, "groupName");
  }
  for (const [tableId, count] of counts) {
    if (count > tables.get(tableId).capacity) {
      throw fail("err.overCapacity", { table: tables.get(tableId).name }, `${tables.get(tableId).name} has more guests than seats.`);
    }
  }
  return plan;
}

const api = { STORAGE_KEY, LIMITS, createPlan, validatePlan, tableSize, clampPosition, occupancy, assignGuest, linkGuests, unlinkGuest, renameGroup, moveGuestToGroup, moveGuestToSeat, removeTable, removeRoom };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.GatherModel = api;
})();
