const BASE_URL = "https://courthive.net/factory";

const form = document.querySelector("#draw-form");
const submitButton = document.querySelector("#submit-button");
const statusText = document.querySelector("#status-text");
const resolvedText = document.querySelector("#resolved-text");
const eventSelect = document.querySelector("#event-select");
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
let cachedParticipants = [];
let cachedParticipantsTournamentId = "";
let loadedEventsTournamentId = "";
let loadedEvents = [];
let eventLoadToken = 0;

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const tournamentId = String(formData.get("tournamentId") || "").trim();
  const playerName = String(formData.get("playerName") || "").trim();
  const eventId = String(formData.get("eventId") || "").trim();

  if (!tournamentId || !playerName || !eventId) {
    setStatus("Enter a tournament ID, select an event, and choose a player.", true);
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
    if (loadedEventsTournamentId !== tournamentId || !loadedEvents.length) {
      setStatus("Loading tournament events.");
      await loadEvents(tournamentId);
    }

    setStatus(`Looking up participant: ${playerName}`);
    const participants = await getParticipants(tournamentId);
    const participant = findParticipantInList(participants, playerName);

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

    const selectedEvent = loadedEvents.find((item) => item.eventId === eventId);
    const participantIndex = buildParticipantIndex(participants);
    resolvedText.textContent = `${resolvedName} (${participantId})`;
    setStatus(`Fetching draw data for ${selectedEvent?.eventName || "selected event"}.`);

    const eventData = await fetchEventData({ tournamentId, eventId });
    const rows = extractDrawRows({
      eventData,
      participantId,
      participantName: resolvedName,
      participantIndex,
    });

    renderDraw(rows, {
      participantName: resolvedName,
      eventName: selectedEvent?.eventName || "Selected event",
    });
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
    const participants = await getParticipants(tournamentId);
    lookupParticipants = getParticipantOptions(participants);
    lookupTournamentId = tournamentId;
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

tournamentInput.addEventListener("change", () => {
  if (tournamentInput.value.trim() !== loadedEventsTournamentId) {
    loadedEvents = [];
    loadedEventsTournamentId = "";
    renderEventOptions([]);
    loadEventsForCurrentTournament();
  }
});

tournamentInput.addEventListener("blur", () => {
  if (tournamentInput.value.trim() !== loadedEventsTournamentId) {
    loadEventsForCurrentTournament();
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

async function getParticipants(tournamentId) {
  if (cachedParticipantsTournamentId === tournamentId && cachedParticipants.length) {
    return cachedParticipants;
  }

  const data = await postJson("/participants", {
    params: { tournamentId },
  });
  cachedParticipants = Array.isArray(data.participants) ? data.participants : [];
  cachedParticipantsTournamentId = tournamentId;
  return cachedParticipants;
}

async function loadEvents(tournamentId) {
  const data = await postJson("/tournamentinfo", { tournamentId });
  const tournamentInfo = data.tournamentInfo || data;
  const eventCandidates = tournamentInfo.eventInfo || tournamentInfo.events || data.eventInfo || data.events || [];

  loadedEvents = eventCandidates
    .map((event) => ({
      eventId: event.eventId || event.id || "",
      eventName: event.eventName || event.drawName || event.name || "Unnamed event",
      eventType: event.eventType || event.eventCategory || event.category || "Event",
      publishStatus: event.publishStatus || event.status || "",
    }))
    .filter((event) => event.eventId)
    .sort((a, b) => a.eventName.localeCompare(b.eventName));

  loadedEventsTournamentId = tournamentId;
  renderEventOptions(loadedEvents);

  if (!loadedEvents.length) {
    throw new Error("No published events were returned for this tournament.");
  }
}

async function loadEventsForCurrentTournament() {
  const tournamentId = tournamentInput.value.trim();
  const token = ++eventLoadToken;

  if (!tournamentId) {
    renderEventOptions([]);
    setStatus("Enter a tournament ID to load events.", true);
    return;
  }

  eventSelect.disabled = true;
  setStatus("Loading tournament events.");

  try {
    await loadEvents(tournamentId);
    if (token !== eventLoadToken) return;
    setStatus(`Loaded ${loadedEvents.length} event${loadedEvents.length === 1 ? "" : "s"}. Choose an event and participant.`);
  } catch (error) {
    if (token !== eventLoadToken) return;
    renderEventOptions([]);
    setStatus(error.message || "Unable to load events.", true);
  }
}

function renderEventOptions(events) {
  eventSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = events.length ? "Select an event" : "Events load automatically";
  eventSelect.appendChild(placeholder);

  events.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.eventId;
    option.textContent = event.eventType && event.eventType !== "Event" ? `${event.eventName} (${event.eventType})` : event.eventName;
    eventSelect.appendChild(option);
  });

  eventSelect.disabled = events.length === 0;
}

async function fetchEventData({ tournamentId, eventId }) {
  return postJson("/eventdata", {
    tournamentId,
    eventId,
    hydrateParticipants: true,
    usePublishState: true,
    noCache: true,
  });
}

function findParticipantInList(participants, playerName) {
  const normalizedQuery = normalize(playerName);
  const firstToken = normalizedQuery.split(" ")[0] || normalizedQuery;

  return participants.find((participant) => {
    const fullName = getParticipantName(participant);
    const firstName = participant.person?.standardGivenName || "";
    const familyName = participant.person?.standardFamilyName || "";
    const normalizedFull = normalize(fullName);
    const normalizedFirst = normalize(firstName);
    const normalizedFamily = normalize(familyName);

    return (
      fullName === playerName ||
      normalizedFull === normalizedQuery ||
      normalizedFull.includes(normalizedQuery) ||
      normalizedFirst.includes(normalizedQuery) ||
      normalizedFamily.includes(normalizedQuery) ||
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
      source: participant,
    }))
    .filter((participant) => participant.id && participant.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderPlayerLookupResults() {
  const query = normalize(playerLookupQuery.value);
  const matches = lookupParticipants.filter((participant) => !query || normalize(participant.name).includes(query)).slice(0, 80);

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

function extractDrawRows({ eventData, participantId, participantName, participantIndex }) {
  const root = eventData.eventData || eventData;
  const matchups = bestMatchupsById(
    collectObjects(root).filter((item) => {
      return item.matchUpId && (Array.isArray(item.sides) || item.potentialParticipants || item.roundName || item.roundNumber);
    })
  );

  const pathMatchups = participantPathMatchups(matchups, participantId, participantName, participantIndex);

  return pathMatchups
    .map((matchup) => {
      const playerSide = playerSideFor(matchup, participantId, participantIndex);
      const opponentSide = opponentSideFor(matchup, participantId, participantIndex);
      const playerName =
        sideName(playerSide) ||
        potentialParticipantNameFor(matchup, participantId, participantIndex) ||
        feederNamesForSelectedPath(matchup, participantId, participantName, participantIndex, matchups, pathMatchups) ||
        participantName;
      const opponentName =
        sideName(opponentSide) ||
        opponentPotentialNameFor(matchup, participantId, participantName, participantIndex, matchups, pathMatchups) ||
        "TBD";

      return {
        matchUpId: matchup.matchUpId,
        status: matchup.matchUpStatus || "-",
        round: matchup.roundName || matchup.abbreviatedRoundName || `Round ${matchup.roundNumber || "-"}`,
        roundNumber: Number(matchup.roundNumber || 999),
        drawName: matchup.drawName || root.eventName || "Draw",
        player: playerName,
        opponent: opponentName,
        score: scoreForPlayer(matchup, participantId, participantIndex),
        date: matchup.schedule?.scheduledDate || "-",
        time: formatTime(matchup.schedule?.scheduledTime || "-"),
        court: courtNameFor(matchup),
      };
    })
    .sort((a, b) => a.roundNumber - b.roundNumber || a.round.localeCompare(b.round));
}

function participantPathMatchups(matchups, participantId, participantName, participantIndex) {
  const included = new Map();
  const queue = [];

  matchups.forEach((matchup) => {
    if (matchReferencesParticipant(matchup, participantId, participantName, participantIndex)) {
      included.set(matchup.matchUpId, matchup);
      queue.push(matchup);
    }
  });

  while (queue.length) {
    const current = queue.shift();
    if (!canAdvanceSpeculatively(current)) continue;

    const next = matchups.find((matchup) => {
      return (
        current.winnerMatchUpId &&
        matchup.matchUpId === current.winnerMatchUpId &&
        matchup.structureId === current.structureId
      );
    });

    if (next && !included.has(next.matchUpId)) {
      included.set(next.matchUpId, next);
      queue.push(next);
    }
  }

  return [...included.values()];
}

function canAdvanceSpeculatively(matchup) {
  return ["", "-", "TO_BE_PLAYED", "SCHEDULED", "IN_PROGRESS"].includes(matchup.matchUpStatus || "");
}

function matchReferencesParticipant(matchup, participantId, participantName, participantIndex) {
  return (
    (matchup.sides || []).some((side) => sideHasParticipant(side, participantId, participantIndex)) ||
    flattenPotentialParticipants(matchup).some((participant) => participantHasId(participant, participantId, participantIndex)) ||
    JSON.stringify(matchup).includes(participantName)
  );
}

function playerSideFor(matchup, participantId, participantIndex) {
  return (matchup.sides || []).find((side) => sideHasParticipant(side, participantId, participantIndex));
}

function opponentSideFor(matchup, participantId, participantIndex) {
  return (matchup.sides || []).find((side) => !sideHasParticipant(side, participantId, participantIndex) && sideName(side));
}

function feederNamesForSelectedPath(matchup, participantId, participantName, participantIndex, matchups, pathMatchups = []) {
  const feeder = matchups.find((candidate) => {
    return (
      candidate.winnerMatchUpId === matchup.matchUpId &&
      candidate.structureId === matchup.structureId &&
      isSelectedPathFeeder(candidate, participantId, participantName, participantIndex, pathMatchups)
    );
  });

  if (!feeder) return "";

  const sideNames = (feeder.sides || []).map(sideName).filter(Boolean);
  const potentialNames = flattenPotentialParticipants(feeder).map(potentialParticipantName).filter(Boolean);
  return uniqueValues(sideNames.length ? sideNames : potentialNames).join(" or ");
}

function isSelectedPathFeeder(matchup, participantId, participantName, participantIndex, pathMatchups = []) {
  return (
    pathMatchups.some((pathMatchup) => pathMatchup.matchUpId === matchup.matchUpId) ||
    matchReferencesParticipant(matchup, participantId, participantName, participantIndex)
  );
}

function potentialParticipantNameFor(matchup, participantId, participantIndex) {
  const participant = flattenPotentialParticipants(matchup).find((item) => participantHasId(item, participantId, participantIndex));
  return potentialParticipantName(participant);
}

function opponentPotentialNameFor(matchup, participantId, participantName, participantIndex, matchups = [], pathMatchups = []) {
  const groups = groupedPotentialParticipants(matchup);
  const groupsWithSelected = groups.filter((group) => group.some((participant) => participantHasId(participant, participantId, participantIndex)));
  const opponentPool = groupsWithSelected.length && groups.length > 1
    ? groups.filter((group) => !group.some((participant) => participantHasId(participant, participantId, participantIndex))).flat()
    : groups.flat();

  const opponentNames = opponentPool
    .filter((participant) => !participantHasId(participant, participantId, participantIndex))
    .map((participant) => potentialParticipantName(participant))
    .filter(Boolean);

  return (
    uniqueValues(opponentNames).join(" or ") ||
    oppositeFeederNamesForSelectedPath(matchup, participantId, participantName, participantIndex, matchups, pathMatchups) ||
    bracketPotentialOpponentNamesFor(matchup, participantId, participantIndex, matchups)
  );
}

function oppositeFeederNamesForSelectedPath(matchup, participantId, participantName, participantIndex, matchups, pathMatchups) {
  const feeders = matchups.filter((candidate) => {
    return candidate.winnerMatchUpId === matchup.matchUpId && candidate.structureId === matchup.structureId;
  });

  if (feeders.length < 2) return "";

  const selectedFeederIds = new Set(
    feeders
      .filter((feeder) => isSelectedPathFeeder(feeder, participantId, participantName, participantIndex, pathMatchups))
      .map((feeder) => feeder.matchUpId)
  );

  if (!selectedFeederIds.size) return "";

  const names = feeders
    .filter((feeder) => !selectedFeederIds.has(feeder.matchUpId))
    .flatMap((feeder) => namesForMatchup(feeder))
    .filter(Boolean);

  return uniqueValues(names).join(" or ");
}

function namesForMatchup(matchup) {
  const sideNames = (matchup.sides || []).map(sideName).filter(Boolean);
  if (sideNames.length) return sideNames;
  return flattenPotentialParticipants(matchup).map(potentialParticipantName).filter(Boolean);
}

function potentialParticipantName(participant) {
  if (!participant) return "";
  return participant.participantName || participant.participant?.participantName || getParticipantName(participant);
}

function bracketPotentialOpponentNamesFor(matchup, participantId, participantIndex, matchups) {
  const selectedPositions = drawPositionsForSelectedParticipant(matchup, participantId, participantIndex);
  const possiblePositions = matchup.drawPositionsRange?.possibleDrawPositions || [];
  if (!selectedPositions.length || possiblePositions.length < 2) return "";

  const selectedPosition = selectedPositions[0];
  const opponentPositions = oppositeHalfPositions(possiblePositions, selectedPosition);
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

function drawPositionsForSelectedParticipant(matchup, participantId, participantIndex) {
  return (matchup.sides || [])
    .filter((side) => sideHasParticipant(side, participantId, participantIndex))
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

function scoreForPlayer(matchup, participantId, participantIndex) {
  const score = matchup.score || {};
  if (score.scoreString) return score.scoreString;
  if (!score.scoreStringSide1 || !score.scoreStringSide2 || !Array.isArray(matchup.sides) || matchup.sides.length < 2) {
    return "";
  }

  return sideHasParticipant(matchup.sides[0], participantId, participantIndex) ? score.scoreStringSide1 : score.scoreStringSide2;
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

function sideHasParticipant(side, participantId, participantIndex) {
  return participantIdsFor(side, participantIndex).includes(participantId) || participantIdsFor(side?.participant, participantIndex).includes(participantId);
}

function participantHasId(participant, participantId, participantIndex) {
  return participantIdsFor(participant, participantIndex).includes(participantId);
}

function participantIdsFor(participant, participantIndex) {
  if (!participant) return [];
  const directIds = [
    participant.participantId,
    participant.id,
    participant.participant?.participantId,
    ...(participant.individualParticipantIds || []),
    ...(participant.individualParticipants || []).map((item) => item?.participantId),
    ...(participant.participant?.individualParticipantIds || []),
    ...(participant.participant?.individualParticipants || []).map((item) => item?.participantId),
  ].filter(Boolean);

  const indexedIds = directIds.flatMap((id) => {
    const indexed = participantIndex.get(id);
    if (!indexed) return [];
    return [
      indexed.participantId,
      indexed.id,
      ...(indexed.individualParticipantIds || []),
      ...(indexed.individualParticipants || []).map((item) => item?.participantId),
    ].filter(Boolean);
  });

  return [...new Set([...directIds, ...indexedIds])];
}

function buildParticipantIndex(participants) {
  const index = new Map();
  participants.forEach((participant) => {
    const id = participant.participantId || participant.id || participant.person?.participantId;
    if (id) index.set(id, participant);
  });
  return index;
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
    matchup.roundName,
    matchup.matchUpStatus,
    matchup.schedule?.scheduledDate,
    matchup.schedule?.courtName,
    matchup.score?.scoreString || matchup.score?.scoreStringSide1,
    ...((matchup.sides || []).map(sideName)),
  ].filter(Boolean).length;
}

function renderDraw(rows, { participantName, eventName }) {
  resultsBody.innerHTML = "";
  resultCount.textContent = `${rows.length} ${rows.length === 1 ? "match" : "matches"}`;

  if (!rows.length) {
    resultsBody.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = `No draw matchups found for ${participantName} in ${eventName}.`;
    setStatus("No draw matchups found.");
    return;
  }

  const section = document.createElement("section");
  section.className = "event-section draw-section";
  section.innerHTML = `
    <div class="event-section__heading">
      <h3>${escapeHtml(eventName)}</h3>
      <span>${rows.length} ${rows.length === 1 ? "round match" : "round matches"}</span>
    </div>
    <div class="draw-lane"></div>
  `;

  const lane = section.querySelector(".draw-lane");
  rows.forEach((row) => {
    const article = document.createElement("article");
    article.className = "draw-card";
    article.innerHTML = `
      <div class="draw-card__topline">
        <span>${escapeHtml(row.round)}</span>
        <span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span>
      </div>
      <div class="draw-side draw-side--selected">
        <span class="draw-side__label">Selected side</span>
        <strong>${escapeHtml(row.player)}</strong>
      </div>
      <div class="draw-versus">vs</div>
      <div class="draw-side">
        <span class="draw-side__label">Opponent</span>
        <strong>${escapeHtml(row.opponent)}</strong>
      </div>
      <dl class="draw-meta">
        <div><dt>Score</dt><dd>${escapeHtml(row.score || "-")}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(row.date)}</dd></div>
        <div><dt>Time</dt><dd>${escapeHtml(row.time)}</dd></div>
        <div><dt>Court</dt><dd>${escapeHtml(row.court)}</dd></div>
      </dl>
    `;
    lane.appendChild(article);
  });

  resultsBody.appendChild(section);
  emptyState.hidden = true;
  resultsBody.hidden = false;
  setStatus(`Displayed draw path for ${participantName}.`);
}

function clearResults() {
  resolvedText.textContent = "-";
  resultsBody.innerHTML = "";
  resultCount.textContent = "0 matches";
  emptyState.hidden = false;
  emptyState.textContent = "Searching.";
  resultsBody.hidden = true;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Loading draw..." : "Display draw";
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
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

function statusClass(status) {
  return String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

renderEventOptions([]);
loadEventsForCurrentTournament();
