#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./find_upcoming_matches.sh "<tournament_id>" "<player_name>" [scheduled_date]
#
# Examples:
#   ./find_upcoming_matches.sh \
#     "d753a6b4-6592-4d9f-b226-2ab0d2f75106" \
#     "Efrain Sánchez"
#
#   ./find_upcoming_matches.sh \
#     "d753a6b4-6592-4d9f-b226-2ab0d2f75106" \
#     "Efrain" \
#     "2026-04-19"

BASE_URL="https://courthive.net/factory"
TOURNAMENT_ID="${1:-}"
PLAYER_NAME="${2:-}"
SCHEDULED_DATE="${3:-}"

if [[ -z "$TOURNAMENT_ID" || -z "$PLAYER_NAME" ]]; then
  echo "Usage: $0 <tournament_id> <player_name> [scheduled_date]" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

tmp_participants="$(mktemp)"
tmp_schedule="$(mktemp)"
trap 'rm -f "$tmp_participants" "$tmp_schedule"' EXIT

echo "Looking up participant: $PLAYER_NAME" >&2

curl -sS "${BASE_URL}/participants" \
  -H 'Content-Type: application/json' \
  --data "{
    \"params\": {
      \"tournamentId\": \"${TOURNAMENT_ID}\"
    }
  }" > "$tmp_participants"

if jq -e '.error? != null' "$tmp_participants" >/dev/null 2>&1; then
  echo "Participants endpoint error: $(jq -r '.error' "$tmp_participants")" >&2
  exit 2
fi

participant_json="$(
  jq -c --arg name "$PLAYER_NAME" '
    def norm:
      ascii_downcase | gsub("^ +| +$"; "");

    def full_name:
      (
        .participantName
        // .person.fullName
        // .name
        // (
          ((.person.standardGivenName // "") + " " + (.person.standardFamilyName // ""))
          | gsub("^ +| +$"; "")
        )
      );

    def first_name:
      (.person.standardGivenName // "");

    def query_first_token:
      ($name | split(" ")[0]);

    [
      ..
      | objects
      | (full_name) as $full
      | (first_name) as $first
      | select(
          ($full == $name)
          or (($full | norm) == ($name | norm))
          or (($full | norm) | contains($name | norm))
          or (($first | norm) | contains($name | norm))
          or (($first | norm) == (query_first_token | norm))
        )
    ][0] // empty
  ' "$tmp_participants"
)"

if [[ -z "$participant_json" ]]; then
  echo "Participant not found in published participants: $PLAYER_NAME" >&2
  exit 3
fi

participant_id="$(jq -r '
  .participantId
  // .id
  // .person?.participantId
  // empty
' <<<"$participant_json")"

participant_name_resolved="$(jq -r '
  .participantName
  // .person?.fullName
  // (
      ((.person?.standardGivenName // "") + " " + (.person?.standardFamilyName // ""))
      | gsub("^ +| +$"; "")
     )
  // .name
  // "unknown"
' <<<"$participant_json")"

if [[ -z "$participant_id" ]]; then
  echo "Participant found, but no participantId was present in the response." >&2
  exit 4
fi

echo "Resolved participant: $participant_name_resolved" >&2
echo "Fetching scheduled matchups..." >&2

if [[ -n "$SCHEDULED_DATE" ]]; then
  schedule_payload="$(cat <<JSON
{
  "params": {
    "tournamentId": "$TOURNAMENT_ID",
    "noCache": true,
    "matchUpFilters": {
      "scheduledDate": "$SCHEDULED_DATE"
    },
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
JSON
)"
else
  schedule_payload="$(cat <<JSON
{
  "params": {
    "tournamentId": "$TOURNAMENT_ID",
    "noCache": true,
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
JSON
)"
fi

curl -sS "${BASE_URL}/scheduledmatchUps" \
  -H 'Content-Type: application/json' \
  --data "$schedule_payload" > "$tmp_schedule"

if jq -e '.error? != null' "$tmp_schedule" >/dev/null 2>&1; then
  echo "scheduledmatchUps endpoint error: $(jq -r '.error' "$tmp_schedule")" >&2
  exit 5
fi

rows="$(
  jq -r --arg pid "$participant_id" --arg pname "$participant_name_resolved" '
    def matchup_objects:
      [
        ..
        | objects
        | select(
            (.matchUpId? != null)
            and (
              .sides? != null
              or .potentialParticipants? != null
              or .roundName? != null
              or .eventName? != null
            )
          )
      ];

	    def participant_name($side):
	      ($side.participant.participantName // $side.participantName // "");

	    def side_participant_ids($side):
	      [
	        $side.participantId?,
	        $side.participant.participantId?,
	        ($side.individualParticipantIds // [])[]?,
	        ($side.participant.individualParticipantIds // [])[]?,
	        ($side.participant.individualParticipants // [])[]?.participantId?
	      ] | map(select(. != null and . != ""));

	    def side_has_participant($side; $pid):
	      (side_participant_ids($side) | index($pid)) != null;

	    def potential_participant_ids($participant):
	      [
	        $participant.participantId?,
	        ($participant.individualParticipantIds // [])[]?,
	        ($participant.individualParticipants // [])[]?.participantId?
	      ] | map(select(. != null and . != ""));

	    def potential_has_participant($participant; $pid):
	      (potential_participant_ids($participant) | index($pid)) != null;

	    def player_name($m; $pid; $fallback):
	      (
	        [ ($m.sides // [])[]?
	          | select(side_has_participant(.; $pid))
	          | participant_name(.)
	        ][0]
	      ) // (
	        [ ($m.potentialParticipants // [])[]?[]?
	          | select(potential_has_participant(.; $pid))
	          | (.participantName // "")
	        ][0]
	      ) // $fallback;

	    def opponent_name($m; $pid):
	      (
	        [ ($m.sides // [])[]?
	          | select(side_has_participant(.; $pid) | not)
	          | participant_name(.)
	          | select(. != "")
	        ][0]
	      ) // (
	        [ ($m.potentialParticipants // [])[]?[]?
	          | select(potential_has_participant(.; $pid) | not)
	          | (.participantName // "")
	          | select(. != "")
	        ][0]
	      ) // "TBD";

	    def score_for_player($m; $pid):
	      if ($m.score.scoreStringSide1? and $m.score.scoreStringSide2? and (($m.sides // []) | length) >= 2) then
	        if side_has_participant($m.sides[0]; $pid)
	        then $m.score.scoreStringSide1
	        else $m.score.scoreStringSide2
	        end
      else
        ""
      end;

    def matching_matchups:
	      [
	        matchup_objects[]
	        | select(
	            (
	              [ (.sides // [])[]?
	                | select(side_has_participant(.; $pid))
	              ] | length
	            ) > 0
	            or
	            (
	              [ (.potentialParticipants // [])[]?[]?
	                | select(potential_has_participant(.; $pid))
	              ] | length
	            ) > 0
	            or
	            (tostring | test($pname))
	          )
        | {
            status: (.matchUpStatus // "-"),
            date: (.schedule.scheduledDate // "-"),
            time: (.schedule.scheduledTime // "-"),
            event: (.eventName // .drawName // "-"),
            round: (.roundName // .abbreviatedRoundName // "-"),
            player: player_name(.; $pid; $pname),
            opponent: opponent_name(.; $pid),
            court: (
              if .schedule.courtName? then
                ((.schedule.venueName // "") +
                (if .schedule.venueName? and .schedule.courtName? then " / " else "" end) +
                (.schedule.courtName // ""))
              else "-"
              end
            ),
            score: score_for_player(.; $pid),
            sort_date: (.schedule.isoDateString // .schedule.scheduledDate // "9999-12-31"),
            sort_round: (.roundNumber // 999),
            match_up_id: (.matchUpId // "")
          }
      ]
      | unique_by(.match_up_id)
      | sort_by(.sort_date, .sort_round);

    matching_matchups as $rows
    | if ($rows | length) == 0 then
        empty
      else
        ([
          "STATUS",
          "DATE",
          "TIME",
          "EVENT",
          "ROUND",
          "PLAYER",
          "OPPONENT",
          "COURT",
          "SCORE"
        ] | @tsv),
        ($rows[] | [
          .status,
          .date,
          .time,
          .event,
          .round,
          .player,
          .opponent,
          .court,
          .score
        ] | @tsv)
      end
  ' "$tmp_schedule"
)"

if [[ -z "$rows" ]]; then
  echo "No matching scheduled or upcoming matchups found for $participant_name_resolved"
  exit 0
fi

printf "\nMatches for %s\n\n" "$participant_name_resolved"

if command -v column >/dev/null 2>&1; then
  printf "%s\n" "$rows" | column -t -s $'\t'
else
  printf "%s\n" "$rows"
fi
