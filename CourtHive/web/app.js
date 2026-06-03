const BASE_URL = "https://courthive.net/factory";

const form = document.querySelector("#match-form");
const submitButton = document.querySelector("#submit-button");
const statusText = document.querySelector("#status-text");
const resolvedText = document.querySelector("#resolved-text");
const resultCount = document.querySelector("#result-count");
const resultsBody = document.querySelector("#results-body");
const emptyState = document.querySelector("#empty-state");
const tournamentInput = document.querySelector("#tournament-id");
const playerInput = document.querySelector("#player-name");
const openPlayerLookupButton = document.querySelector("#open-player-lookup");
const playerDialog = document.querySelector("#player-dialog");
const closePlayerDialogButton = document.querySelector("#close-player-dialog");
const playerLookupQuery = document.querySelector("#player-lookup-query");
const playerLookupStatus = document.querySelector("#player-lookup-status");
const playerLookupResults = document.querySelector("#player-lookup-results");
const SEARCH_COOLDOWN_MS = 3000;
let lastSearchStartedAt = 0;
let lookupParticipants = [];
let lookupTournamentId = "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const tournamentId = String(formData.get("tournamentId") || "").trim();
  const playerName = String(formData.get("playerName") || "").trim();
  const scheduledDate = String(formData.get("scheduledDate") || "").trim();

  if (!tournamentId || !playerName) {
    setStatus("Enter a tournament ID and player name.", true);
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
  clearResults();

  try {
    setStatus(`Looking up participant: ${playerName}`);
    const participant = await findParticipant({ tournamentId, playerName });

    if (!participant) {
      setStatus(`Participant not found in published participants: ${playerName}`, true);
      return;
    }

    const participantId = participant.participantId || participant.id || participant.person?.participantId;
    const resolvedName = getParticipantName(participant) || playerName;

    if (!participantId) {
      setStatus("Participant found, but no participantId was present in the response.", true);
      return;
    }

    resolvedText.textContent = `${resolvedName} (${participantId})`;
    setStatus("Fetching scheduled matchups.");

    const schedule = await fetchSchedule({ tournamentId, scheduledDate });
    const rows = extractMatches({ schedule, participantId, participantName: resolvedName });

    renderRows(rows, resolvedName);
  } catch (error) {
    setStatus(error.message || "Request failed.", true);
  } finally {
    setLoading(false);
  }
});

openPlayerLookupButton.addEventListener("click", async () => {
  const tournamentId = tournamentInput.value.trim();
  if (!tournamentId) {
    setStatus("Enter a tournament ID before opening player lookup.", true);
    tournamentInput.focus();
    return;
  }

  playerDialog.showModal();
  playerLookupQuery.value = playerInput.value.trim();
  playerLookupResults.innerHTML = "";
  playerLookupStatus.textContent = "Loading participants.";

  try {
    if (lookupTournamentId !== tournamentId || lookupParticipants.length === 0) {
      const data = await postJson("/participants", {
        params: { tournamentId },
      });
      lookupParticipants = getParticipantOptions(data.participants || []);
      lookupTournamentId = tournamentId;
    }
    renderPlayerLookupResults();
    playerLookupQuery.focus();
  } catch (error) {
    playerLookupStatus.textContent = error.message || "Unable to load participants.";
  }
});

closePlayerDialogButton.addEventListener("click", () => {
  playerDialog.close();
});

playerLookupQuery.addEventListener("input", () => {
  renderPlayerLookupResults();
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

async function findParticipant({ tournamentId, playerName }) {
  const data = await postJson("/participants", {
    params: { tournamentId },
  });

  const participants = Array.isArray(data.participants) ? data.participants : [];
  const firstToken = normalize(playerName).split(" ")[0] || normalize(playerName);

  return participants.find((participant) => {
    const fullName = getParticipantName(participant);
    const firstName = participant.person?.standardGivenName || "";
    const normalizedFull = normalize(fullName);
    const normalizedFirst = normalize(firstName);

    return (
      fullName === playerName ||
      normalizedFull === normalize(playerName) ||
      normalizedFull.includes(normalize(playerName)) ||
      normalizedFirst.includes(normalize(playerName)) ||
      normalizedFirst === firstToken
    );
  });
}

function getParticipantOptions(participants) {
  return participants
    .map((participant) => ({
      id: participant.participantId || participant.id || participant.person?.participantId || "",
      name: getParticipantName(participant),
      type: participant.participantType || "PARTICIPANT",
    }))
    .filter((participant) => participant.id && participant.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderPlayerLookupResults() {
  const query = normalize(playerLookupQuery.value);
  const matches = lookupParticipants
    .filter((participant) => !query || normalize(participant.name).includes(query))
    .slice(0, 80);

  playerLookupResults.innerHTML = "";
  playerLookupStatus.textContent = `${matches.length} ${matches.length === 1 ? "match" : "matches"} shown.`;

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "lookup-empty";
    empty.textContent = "No matching participants.";
    playerLookupResults.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  matches.forEach((participant) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lookup-result";
    button.innerHTML = `
      <span>${escapeHtml(participant.name)}</span>
      <small>${escapeHtml(participant.type)}</small>
    `;
    button.addEventListener("click", () => {
      playerInput.value = participant.name;
      playerInput.focus();
      playerDialog.close();
      setStatus(`Selected player: ${participant.name}`);
    });
    fragment.appendChild(button);
  });
  playerLookupResults.appendChild(fragment);
}

async function fetchSchedule({ tournamentId, scheduledDate }) {
  const params = {
    tournamentId,
    noCache: true,
    hydrateParticipants: true,
    nextMatchUps: true,
  };

  if (scheduledDate) {
    params.matchUpFilters = { scheduledDate };
  }

  return postJson("/scheduledmatchUps", { params });
}

function extractMatches({ schedule, participantId, participantName }) {
  const matchups = bestMatchupsById(
    collectObjects(schedule).filter((item) => {
      return (
        item.matchUpId &&
        (Array.isArray(item.sides) || item.potentialParticipants || item.roundName || item.eventName) &&
        matchReferencesParticipant(item, participantId, participantName)
      );
    })
  );

  const candidateRows = matchups
    .map((matchup) => ({
      matchUpId: matchup.matchUpId,
      status: matchup.matchUpStatus || "-",
      date: matchup.schedule?.scheduledDate || "-",
      time: formatTime(matchup.schedule?.scheduledTime || "-"),
      event: matchup.eventName || matchup.drawName || "-",
      round: matchup.roundName || matchup.abbreviatedRoundName || "-",
      player: playerNameFor(matchup, participantId) || participantName,
      opponent: opponentNameFor(matchup, participantId, matchups),
      court: courtNameFor(matchup),
      score: scoreForPlayer(matchup, participantId),
      sortDate: matchup.schedule?.isoDateString || matchup.schedule?.scheduledDate || "9999-12-31",
      sortRound: matchup.roundNumber || 999,
    }));

  return candidateRows.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || Number(a.sortRound) - Number(b.sortRound));
}

function matchReferencesParticipant(matchup, participantId, participantName) {
  return (
    (matchup.sides || []).some((side) => sideHasParticipant(side, participantId)) ||
    flattenPotentialParticipants(matchup).some((participant) => participantHasId(participant, participantId)) ||
    JSON.stringify(matchup).includes(participantName)
  );
}

function playerNameFor(matchup, participantId) {
  const side = (matchup.sides || []).find((item) => sideHasParticipant(item, participantId));
  const potential = flattenPotentialParticipants(matchup).find((item) => participantHasId(item, participantId));
  return sideName(side) || potential?.participantName || "";
}

function opponentNameFor(matchup, participantId, matchups = []) {
  const side = (matchup.sides || []).find((item) => !sideHasParticipant(item, participantId) && sideName(item));
  return sideName(side) || potentialOpponentNamesFor(matchup, participantId) || bracketPotentialOpponentNamesFor(matchup, participantId, matchups) || "TBD";
}

function potentialOpponentNamesFor(matchup, participantId) {
  const groups = groupedPotentialParticipants(matchup);
  if (!groups.length) return "";

  const groupsWithSelected = groups.filter((group) => group.some((participant) => participantHasId(participant, participantId)));
  const opponentPool = groupsWithSelected.length && groups.length > 1
    ? groups.filter((group) => !group.some((participant) => participantHasId(participant, participantId))).flat()
    : groups.flat();

  const opponentNames = opponentPool
    .filter((participant) => !participantHasId(participant, participantId))
    .map((participant) => potentialParticipantName(participant))
    .filter(Boolean);

  return uniqueValues(opponentNames).join(" or ");
}

function potentialParticipantName(participant) {
  if (!participant) return "";
  return participant.participantName || participant.participant?.participantName || getParticipantName(participant);
}

function bracketPotentialOpponentNamesFor(matchup, participantId, matchups) {
  const selectedPositions = drawPositionsForSelectedParticipant(matchup, participantId);
  const possiblePositions = matchup.drawPositionsRange?.possibleDrawPositions || [];
  if (!selectedPositions.length || possiblePositions.length < 2) return "";

  const opponentPositions = oppositeHalfPositions(possiblePositions, selectedPositions[0]);
  if (!opponentPositions.length) return "";

  const sourceMatchup = matchups.find((candidate) => {
    if (candidate.matchUpId === matchup.matchUpId || candidate.structureId !== matchup.structureId) return false;
    if (Number(candidate.roundNumber) !== Number(matchup.roundNumber) - 1) return false;
    const candidatePositions = candidate.drawPositionsRange?.possibleDrawPositions || [];
    return sameNumberSet(candidatePositions, opponentPositions);
  });

  if (!sourceMatchup) return "";

  const names = (sourceMatchup.sides || []).map(sideName).filter(Boolean);
  return uniqueValues(names).join(" or ");
}

function drawPositionsForSelectedParticipant(matchup, participantId) {
  return (matchup.sides || [])
    .filter((side) => sideHasParticipant(side, participantId))
    .flatMap((side) => [side.drawPosition, ...(side.drawPositions || [])])
    .filter((position) => Number.isFinite(Number(position)))
    .map(Number);
}

function oppositeHalfPositions(possiblePositions, selectedPosition) {
  const positions = [...possiblePositions].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const midpoint = Math.ceil(positions.length / 2);
  const firstHalf = positions.slice(0, midpoint);
  const secondHalf = positions.slice(midpoint);
  return firstHalf.includes(Number(selectedPosition)) ? secondHalf : firstHalf;
}

function sameNumberSet(first, second) {
  if (first.length !== second.length) return false;
  const left = [...first].map(Number).sort((a, b) => a - b);
  const right = [...second].map(Number).sort((a, b) => a - b);
  return left.every((value, index) => value === right[index]);
}

function scoreForPlayer(matchup, participantId) {
  const score = matchup.score || {};
  if (!score.scoreStringSide1 || !score.scoreStringSide2 || !Array.isArray(matchup.sides) || matchup.sides.length < 2) {
    return "";
  }

  return sideHasParticipant(matchup.sides[0], participantId) ? score.scoreStringSide1 : score.scoreStringSide2;
}

function courtNameFor(matchup) {
  const venue = matchup.schedule?.venueName || "";
  const court = matchup.schedule?.courtName || "";
  if (!court) return "-";
  return venue ? `${venue} / ${court}` : court;
}

function sideName(side) {
  return side?.participant?.participantName || side?.participantName || "";
}

function sideHasParticipant(side, participantId) {
  return participantIdsFor(side).includes(participantId) || participantIdsFor(side?.participant).includes(participantId);
}

function participantHasId(participant, participantId) {
  return participantIdsFor(participant).includes(participantId);
}

function participantIdsFor(participant) {
  if (!participant) return [];
  return [
    participant.participantId,
    participant.id,
    participant.participant?.participantId,
    ...(participant.individualParticipantIds || []),
    ...(participant.individualParticipants || []).map((item) => item?.participantId),
    ...(participant.participant?.individualParticipantIds || []),
    ...(participant.participant?.individualParticipants || []).map((item) => item?.participantId),
  ].filter(Boolean);
}

function getParticipantName(participant) {
  const personName = [participant.person?.standardGivenName, participant.person?.standardFamilyName].filter(Boolean).join(" ");
  return participant.participantName || participant.person?.fullName || participant.name || personName;
}

function flattenPotentialParticipants(matchup) {
  return groupedPotentialParticipants(matchup).flat();
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

function uniqueValues(values) {
  return [...new Set(values)];
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
    matchup.schedule?.courtName,
    matchup.score?.scoreString || matchup.score?.scoreStringSide1,
    ...((matchup.sides || []).map(sideName)),
    ...flattenPotentialParticipants(matchup).map(potentialParticipantName),
  ].filter(Boolean).length;
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

function bestRowsByMatchUp(rows) {
  const rowsById = new Map();
  rows.forEach((row) => {
    const current = rowsById.get(row.matchUpId);
    if (!current || rowQuality(row) > rowQuality(current)) {
      rowsById.set(row.matchUpId, row);
    }
  });
  return [...rowsById.values()];
}

function rowQuality(row) {
  return [
    row.player,
    row.opponent && row.opponent !== "TBD" ? row.opponent : "",
    row.event && row.event !== "-" ? row.event : "",
    row.round && row.round !== "-" ? row.round : "",
    row.date && row.date !== "-" ? row.date : "",
    row.court && row.court !== "-" ? row.court : "",
    row.score && row.score !== "-" ? row.score : "",
  ].filter(Boolean).length;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatTime(value) {
  if (!value || value === "-") return "-";
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function renderRows(rows, participantName) {
  resultsBody.innerHTML = "";
  resultCount.textContent = `${rows.length} ${rows.length === 1 ? "result" : "results"}`;

  if (!rows.length) {
    resultsBody.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = `No matching scheduled or upcoming matchups found for ${participantName}.`;
    setStatus("No matches found.");
    return;
  }

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
              <th>Status</th>
              <th>Date</th>
              <th>Time</th>
              <th>Round</th>
              <th>Player</th>
              <th>Opponent</th>
              <th>Court</th>
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
        <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.time)}</td>
        <td>${escapeHtml(row.round)}</td>
        <td>${escapeHtml(row.player)}</td>
        <td>${escapeHtml(row.opponent)}</td>
        <td>${escapeHtml(row.court)}</td>
        <td class="score">${escapeHtml(row.score || "-")}</td>
      `;
      tbody.appendChild(tr);
    });

    fragment.appendChild(section);
  });

  resultsBody.appendChild(fragment);
  emptyState.hidden = true;
  resultsBody.hidden = false;
  setStatus(`Displayed ${rows.length} match${rows.length === 1 ? "" : "es"}.`);
}

function clearResults() {
  resolvedText.textContent = "-";
  resultsBody.innerHTML = "";
  resultCount.textContent = "0 results";
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

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Searching..." : "⌕ Find matches";
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
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
