const BASE_URL = "https://courthive.net/factory";

const form = document.querySelector("#date-form");
const submitButton = document.querySelector("#submit-button");
const statusText = document.querySelector("#status-text");
const selectedDateText = document.querySelector("#selected-date-text");
const resultCount = document.querySelector("#result-count");
const resultsTitle = document.querySelector("#results-title");
const resultsBody = document.querySelector("#results-body");
const emptyState = document.querySelector("#empty-state");
const scheduledDateInput = document.querySelector("#scheduled-date");
const viewModeInputs = document.querySelectorAll('input[name="viewMode"]');

const SEARCH_COOLDOWN_MS = 3000;
let lastSearchStartedAt = 0;
let currentRows = [];
let currentDate = "";

scheduledDateInput.value = todayLocalDate();

viewModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    renderCurrentRows();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const tournamentId = String(formData.get("tournamentId") || "").trim();
  const scheduledDate = String(formData.get("scheduledDate") || "").trim();

  if (!tournamentId || !scheduledDate) {
    setStatus("Enter a tournament ID and scheduled date.", true);
    return;
  }

  const now = Date.now();
  const elapsed = now - lastSearchStartedAt;
  if (elapsed < SEARCH_COOLDOWN_MS) {
    const seconds = Math.ceil((SEARCH_COOLDOWN_MS - elapsed) / 1000);
    setStatus(`Please wait ${seconds}s before searching again.`, true);
    return;
  }
  lastSearchStartedAt = now;

  setLoading(true);
  clearResults(scheduledDate);

  try {
    setStatus(`Fetching matches scheduled for ${scheduledDate}.`);
    const schedule = await fetchDateSchedule({ tournamentId, scheduledDate });
    const rows = extractDateRows({ schedule, scheduledDate });
    renderRows(rows, scheduledDate);
  } catch (error) {
    setStatus(error.message || "Request failed.", true);
  } finally {
    setLoading(false);
  }
});

async function postJson(path, payload) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${path}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`${path} error: ${data.error}`);
  }
  return data;
}

async function fetchDateSchedule({ tournamentId, scheduledDate }) {
  return postJson("/scheduledmatchUps", {
    params: {
      tournamentId,
      noCache: true,
      matchUpFilters: { scheduledDate },
      hydrateParticipants: true,
      nextMatchUps: true,
    },
  });
}

function extractDateRows({ schedule, scheduledDate }) {
  const allMatchups = bestMatchupsById(
    collectObjects(schedule).filter((item) => {
      return item.matchUpId && (Array.isArray(item.sides) || item.potentialParticipants || item.roundName || item.eventName);
    })
  );
  const dateMatchups = allMatchups.filter((matchup) => matchup.schedule?.scheduledDate === scheduledDate);

  return dateMatchups
    .map((matchup) => {
      const sides = sideSlots(matchup);
      return {
        matchUpId: matchup.matchUpId,
        status: matchup.matchUpStatus || "-",
        date: matchup.schedule?.scheduledDate || "-",
        time: formatTime(matchup.schedule?.scheduledTime || "-"),
        event: matchup.eventName || matchup.drawName || "-",
        round: matchup.roundName || matchup.abbreviatedRoundName || "-",
        side1: matchupSideName(matchup, sides[0], 0, allMatchups),
        side2: matchupSideName(matchup, sides[1], 1, allMatchups),
        court: courtNameFor(matchup),
        score: scoreString(matchup),
        sortTime: formatTime(matchup.schedule?.scheduledTime || "99:99"),
        sortCourt: courtNameFor(matchup),
        sortRound: matchup.roundNumber || 999,
      };
    })
    .sort((a, b) => {
      return (
        a.sortTime.localeCompare(b.sortTime) ||
        a.sortCourt.localeCompare(b.sortCourt) ||
        Number(a.sortRound) - Number(b.sortRound) ||
        a.event.localeCompare(b.event)
      );
    });
}

function sidesByNumber(matchup) {
  return [...(matchup.sides || [])].sort((a, b) => sideNumberFor(a) - sideNumberFor(b));
}

function sideSlots(matchup) {
  const slots = [undefined, undefined];
  const unknownSides = [];

  (matchup.sides || []).forEach((side) => {
    const sideNumber = sideNumberFor(side);
    if (sideNumber === 1 || sideNumber === 2) {
      slots[sideNumber - 1] = side;
    } else {
      unknownSides.push(side);
    }
  });

  unknownSides.forEach((side) => {
    const missingIndex = slots.findIndex((slot) => !slot);
    if (missingIndex !== -1) slots[missingIndex] = side;
  });

  return slots;
}

function sideNumberFor(side) {
  const sideNumber = Number(side?.sideNumber || side?.displaySideNumber);
  return Number.isFinite(sideNumber) ? sideNumber : 999;
}

function matchupSideName(matchup, side, groupIndex, matchups) {
  const directName = sideName(side);
  if (directName) return directName;

  const feederName = feederSideName(matchup, groupIndex, matchups);
  if (feederName) return feederName;

  const groups = groupedPotentialParticipants(matchup);
  const group = groups[groupIndex] || (groups.length === 1 && sideIsUnresolved(side) ? groups[0] : []);
  const names = group.map(potentialParticipantName).filter(Boolean);
  return uniqueValues(names).join(" or ") || "TBD";
}

function sideIsUnresolved(side) {
  return !sideName(side);
}

function feederSideName(matchup, groupIndex, matchups) {
  const feeder = feederMatchupsFor(matchup, matchups)[groupIndex];
  if (!feeder) return "";
  return namesForMatchup(feeder).join(" or ");
}

function feederMatchupsFor(matchup, matchups) {
  return matchups
    .filter((candidate) => {
      if (candidate.matchUpId === matchup.matchUpId) return false;
      if (candidate.winnerMatchUpId !== matchup.matchUpId) return false;
      if (matchup.structureId && candidate.structureId && candidate.structureId !== matchup.structureId) return false;
      return true;
    })
    .sort((a, b) => {
      return (
        firstDrawPosition(a) - firstDrawPosition(b) ||
        Number(a.roundNumber || 999) - Number(b.roundNumber || 999) ||
        String(a.matchUpId).localeCompare(String(b.matchUpId))
      );
    });
}

function namesForMatchup(matchup) {
  const sideNames = sidesByNumber(matchup).map(sideName).filter(Boolean);
  if (sideNames.length) return uniqueValues(sideNames);

  const potentialNames = groupedPotentialParticipants(matchup).flat().map(potentialParticipantName).filter(Boolean);
  return uniqueValues(potentialNames);
}

function firstDrawPosition(matchup) {
  const positions = [
    ...(matchup.drawPositions || []),
    ...((matchup.sides || []).flatMap((side) => [side.drawPosition, ...(side.drawPositions || [])])),
    ...(matchup.drawPositionsRange?.possibleDrawPositions || []),
  ]
    .map(Number)
    .filter(Number.isFinite);

  return positions.length ? Math.min(...positions) : 999999;
}

function sideName(side) {
  return side?.participant?.participantName || side?.participantName || "";
}

function potentialParticipantName(participant) {
  if (!participant) return "";
  return participant.participantName || participant.participant?.participantName || getParticipantName(participant);
}

function getParticipantName(participant) {
  const personName = [participant.person?.standardGivenName, participant.person?.standardFamilyName].filter(Boolean).join(" ");
  return participant.participantName || participant.person?.fullName || participant.name || personName;
}

function groupedPotentialParticipants(matchup) {
  return (matchup.potentialParticipants || [])
    .map((group) => flattenParticipantGroup(group))
    .filter((group) => group.length);
}

function flattenParticipantGroup(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenParticipantGroup(item));
  if (typeof value !== "object") return [];
  return [value];
}

function scoreString(matchup) {
  const score = matchup.score || {};
  return score.scoreString || score.scoreStringSide1 || score.scoreStringSide2 || "";
}

function courtNameFor(matchup) {
  const venue = matchup.schedule?.venueName || "";
  const court = matchup.schedule?.courtName || "";
  if (!court) return "-";
  return venue ? `${venue} / ${court}` : court;
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, output));
    return output;
  }

  output.push(value);
  Object.values(value).forEach((item) => collectObjects(item, output));
  return output;
}

function bestMatchupsById(matchups) {
  const matchupsById = new Map();
  matchups.forEach((matchup) => {
    const current = matchupsById.get(matchup.matchUpId);
    if (!current || matchupQuality(matchup) > matchupQuality(current)) {
      matchupsById.set(matchup.matchUpId, matchup);
    }
  });
  return [...matchupsById.values()];
}

function matchupQuality(matchup) {
  return [
    matchup.eventName || matchup.drawName,
    matchup.roundName,
    matchup.matchUpStatus,
    matchup.schedule?.scheduledDate,
    matchup.schedule?.scheduledTime,
    matchup.schedule?.courtName,
    matchup.score?.scoreString || matchup.score?.scoreStringSide1,
    ...((matchup.sides || []).map(sideName)),
    ...groupedPotentialParticipants(matchup).flat().map(potentialParticipantName),
  ].filter(Boolean).length;
}

function renderRows(rows, scheduledDate) {
  currentRows = rows;
  currentDate = scheduledDate;
  renderCurrentRows();
}

function renderCurrentRows() {
  resultsBody.innerHTML = "";
  resultCount.textContent = `${currentRows.length} ${currentRows.length === 1 ? "match" : "matches"}`;
  resultsTitle.textContent = viewMode() === "courts" ? "Court schedule" : "Matches by event";

  if (!currentRows.length) {
    resultsBody.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = `No published matchups found for ${currentDate}.`;
    setStatus("No matches found.");
    return;
  }

  if (viewMode() === "courts") {
    renderCourtGrid(currentRows);
  } else {
    renderEventList(currentRows);
  }

  emptyState.hidden = true;
  resultsBody.hidden = false;
  setStatus(`Displayed ${currentRows.length} match${currentRows.length === 1 ? "" : "es"} for ${currentDate}.`);
}

function renderEventList(rows) {
  const fragment = document.createDocumentFragment();
  groupRowsByEvent(rows).forEach(({ event, rows: eventRows }) => {
    const section = document.createElement("section");
    section.className = "event-section";
    section.innerHTML = `
      <div class="event-section__heading">
        <h3>${escapeHtml(event)}</h3>
        <span>${eventRows.length} ${eventRows.length === 1 ? "match" : "matches"}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Court</th>
              <th>Status</th>
              <th>Round</th>
              <th>Side 1</th>
              <th>Side 2</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    const tbody = section.querySelector("tbody");
    eventRows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.time)}</td>
        <td>${escapeHtml(row.court)}</td>
        <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>${escapeHtml(row.round)}</td>
        <td>${escapeHtml(row.side1)}</td>
        <td>${escapeHtml(row.side2)}</td>
        <td class="score">${escapeHtml(row.score || "-")}</td>
      `;
      tbody.appendChild(tr);
    });

    fragment.appendChild(section);
  });

  resultsBody.appendChild(fragment);
}

function renderCourtGrid(rows) {
  const courts = uniqueValues(rows.map((row) => row.court || "-")).sort((a, b) => a.localeCompare(b));
  const times = uniqueValues(rows.map((row) => row.time || "-")).sort(compareScheduleTimes);
  const section = document.createElement("section");
  section.className = "event-section schedule-section";
  section.innerHTML = `
    <div class="event-section__heading">
      <h3>Courts by time</h3>
      <span>${courts.length} ${courts.length === 1 ? "court" : "courts"}</span>
    </div>
    <div class="table-wrap">
      <table class="schedule-grid">
        <thead>
          <tr>
            <th>Time</th>
            ${courts.map((court) => `<th>${escapeHtml(court)}</th>`).join("")}
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const table = section.querySelector("table");
  table.style.minWidth = `${120 + courts.length * 240}px`;

  const tbody = section.querySelector("tbody");
  times.forEach((time) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th scope="row">${escapeHtml(time)}</th>`;

    courts.forEach((court) => {
      const matches = rows.filter((row) => (row.time || "-") === time && (row.court || "-") === court);
      const td = document.createElement("td");
      td.className = "schedule-cell";
      td.innerHTML = matches.length ? matches.map(scheduleMatchHtml).join("") : '<span class="schedule-empty">-</span>';
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  resultsBody.appendChild(section);
}

function scheduleMatchHtml(row) {
  return `
    <article class="schedule-match">
      <div class="schedule-match__topline">
        <span>${escapeHtml(row.event)}</span>
        <span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span>
      </div>
      <div class="schedule-match__round">${escapeHtml(row.round)}</div>
      <div class="schedule-match__sides">
        <strong>${escapeHtml(row.side1)}</strong>
        <span>vs</span>
        <strong>${escapeHtml(row.side2)}</strong>
      </div>
      ${row.score ? `<div class="schedule-match__score">${escapeHtml(row.score)}</div>` : ""}
    </article>
  `;
}

function clearResults(scheduledDate) {
  currentRows = [];
  currentDate = scheduledDate || "";
  selectedDateText.textContent = scheduledDate || "-";
  resultsBody.innerHTML = "";
  resultCount.textContent = "0 matches";
  resultsTitle.textContent = viewMode() === "courts" ? "Court schedule" : "Matches by event";
  emptyState.hidden = false;
  emptyState.textContent = "Searching.";
  resultsBody.hidden = true;
}

function groupRowsByEvent(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const event = row.event || "Other";
    if (!groups.has(event)) groups.set(event, []);
    groups.get(event).push(row);
  });
  return [...groups.entries()].map(([event, eventRows]) => ({ event, rows: eventRows }));
}

function viewMode() {
  return [...viewModeInputs].find((input) => input.checked)?.value || "courts";
}

function compareScheduleTimes(first, second) {
  if (first === second) return 0;
  if (first === "-") return 1;
  if (second === "-") return -1;
  return first.localeCompare(second);
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Loading matches..." : "Show matches";
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

function formatTime(value) {
  if (!value || value === "-") return "-";
  const match = String(value).match(/T?(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function todayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function statusClass(status) {
  return String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}
