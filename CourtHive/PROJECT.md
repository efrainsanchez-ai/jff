# CourtHive Match Finder, Draw Viewer, And Date Schedule

## Introduction

CourtHive Match Finder is a small client-side tool for looking up tournament matchups from the public CourtHive API. The project started as a shell script for finding one player's scheduled, completed, and upcoming matchups. It now includes static web pages for player match lookup, participant draw-path lookup, and full-day court schedules.

The current target tournament is prefilled in the web pages:

```text
d753a6b4-6592-4d9f-b226-2ab0d2f75106
```

On participant-focused pages, users can type a player name directly or open the Player lookup dialog to search the tournament's published participant list and select a name. On the Date Matches page, users only need a tournament ID and scheduled date.

The project also includes a Draw Viewer page. The Draw Viewer automatically loads a tournament's published events, lets the user select an event type, resolves a participant, and displays that participant's draw path for the selected event, including unresolved future rounds when possible opponents can be inferred from CourtHive draw data.

The Date Matches page lists every published matchup for one tournament on one scheduled date. It uses the same scheduled matchups endpoint as the Match Finder, but does not resolve or filter to a specific participant. Its default result view is a court schedule grid with courts as columns and scheduled times as rows; users can switch to an event-grouped list on the same page.

## CourtHive Background

CourtHive publishes public tournament views at URLs like:

```text
https://courthive.net/pub/#/tournament/<tournamentId>
https://courthive.net/pub/#/tournament/<tournamentId>/events
https://courthive.net/pub/#/tournament/<tournamentId>/schedule
```

Those public pages are backed by CourtHive factory endpoints. The data returned by these endpoints is publish-gated, meaning the public API only returns data that has been published for public viewing by the tournament operator.

This project is an unofficial viewer. It does not store user searches or results; it requests data from CourtHive public endpoints directly from the browser.

## CourtHive GitHub Links

Useful CourtHive GitHub repositories:

- CourtHive public frontend: https://github.com/CourtHive/courthive-public
- CourtHive factory server: https://github.com/CourtHive/competition-factory-server
- CourtHive competition factory engine: https://github.com/CourtHive/competition-factory
- CourtHive components: https://github.com/CourtHive/courthive-components
- CourtHive main landing repository: https://github.com/CourtHive/CourtHive

These repositories were useful for understanding the public frontend routes, the `/factory/*` endpoint patterns, and the underlying competition data model.

## APIs

The project uses the public CourtHive API base URL:

```text
https://courthive.net/factory
```

### Participants

Used to resolve a typed player or pair name into a participant record.

```http
POST /factory/participants
```

Example payload:

```json
{
  "params": {
    "tournamentId": "d753a6b4-6592-4d9f-b226-2ab0d2f75106"
  }
}
```

The response includes a `participants` array when participants are publicly published.

### Scheduled Matchups

Used to fetch scheduled, completed, and upcoming matchups.

```http
POST /factory/scheduledmatchUps
```

Example payload without a date filter:

```json
{
  "params": {
    "tournamentId": "d753a6b4-6592-4d9f-b226-2ab0d2f75106",
    "noCache": true,
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
```

Example payload with a date filter:

```json
{
  "params": {
    "tournamentId": "d753a6b4-6592-4d9f-b226-2ab0d2f75106",
    "noCache": true,
    "matchUpFilters": {
      "scheduledDate": "2026-04-25"
    },
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
```

The important detail is that date filtering must be passed through `params.matchUpFilters.scheduledDate`.

### Tournament Info

Used by the Draw Viewer to load the public event list for a tournament.

```http
POST /factory/tournamentinfo
```

Example payload:

```json
{
  "tournamentId": "d753a6b4-6592-4d9f-b226-2ab0d2f75106"
}
```

Important response fields:

- `tournamentInfo.eventInfo`
- `tournamentInfo.events`

The app accepts either event list shape and normalizes events into:

```json
{
  "eventId": "<eventId>",
  "eventName": "Singles Event",
  "eventType": "SINGLES",
  "publishStatus": "PUBLISHED"
}
```

### Event Data

Used by the Draw Viewer to load matchups for one selected event.

```http
POST /factory/eventdata
```

Example payload:

```json
{
  "tournamentId": "d753a6b4-6592-4d9f-b226-2ab0d2f75106",
  "eventId": "<eventId>",
  "hydrateParticipants": true,
  "usePublishState": true,
  "noCache": true
}
```

The response usually contains an `eventData` object with draw structures, matchups, side assignments, scores, and schedule details.

The Draw Viewer uses `/factory/eventdata` instead of `/factory/scheduledmatchUps` because the event payload contains draw structure information such as `winnerMatchUpId`, `drawPositionsRange`, and upstream feeder matchups. Those fields are required to display later possible rounds before the participant has been assigned to that future matchup.

## Data Structures

The CourtHive API responses contain many fields. This project only depends on a focused subset of the payloads.

### Participants Response

Top-level structure:

```json
{
  "success": true,
  "participants": []
}
```

Participant objects can represent an individual player, a doubles pair, or another competition participant type.

Important fields:

```json
{
  "participantId": "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
  "participantName": "Player1",
  "participantType": "INDIVIDUAL",
  "participantRole": "COMPETITOR",
  "person": {
    "standardGivenName": "Player1",
    "standardFamilyName": "Family1",
    "sex": "MALE"
  },
  "events": [
    {
      "eventId": "82a7ca8b-a6b7-4942-999e-510508b56d47",
      "eventName": "Singles Event"
    }
  ]
}
```

Pair participants include the individual players that make up the side:

```json
{
  "participantId": "e7b59b73-fdf4-4d7e-b814-2ea78b6fe1f2",
  "participantName": "Player1/Player2",
  "participantType": "PAIR",
  "individualParticipantIds": [
    "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
    "dda688b7-818d-4309-968a-52dd7337e295"
  ],
  "individualParticipants": [
    {
      "participantId": "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
      "participantName": "Player1"
    },
    {
      "participantId": "dda688b7-818d-4309-968a-52dd7337e295",
      "participantName": "Player2"
    }
  ]
}
```

The app uses `participantName`, `participantId`, `participantType`, `person.standardGivenName`, and `person.standardFamilyName` for lookup and display.

### Scheduled Matchups Response

Top-level structure:

```json
{
  "success": true,
  "completedMatchUps": [],
  "dateMatchUps": [],
  "courtsData": [],
  "venues": [],
  "mappedParticipants": {}
}
```

Important top-level arrays:

- `dateMatchUps`: scheduled or upcoming matchups.
- `completedMatchUps`: completed matchups that may also be included in court data when requested.
- `courtsData`: courts with assigned matchups for schedule display.
- `venues`: venue and court metadata.
- `mappedParticipants`: participant lookup object when participants are not fully hydrated.

The project recursively scans the schedule response for objects with `matchUpId` because matchups can appear in multiple nested locations, especially inside `courtsData`.

### Matchup Object

Important fields:

```json
{
  "matchUpId": "7c4846e1-7a64-4ede-a49a-c68fc69bfacd",
  "eventName": "Doubles Event",
  "drawName": "Doubles Event",
  "roundName": "R32",
  "roundNumber": 1,
  "matchUpStatus": "TO_BE_PLAYED",
  "winnerMatchUpId": "11f23028-1e7d-4f83-8dc4-10fedf99be00",
  "drawPositions": [
    17,
    24
  ],
  "drawPositionsRange": {
    "possibleDrawPositions": [
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24
    ]
  },
  "schedule": {
    "scheduledDate": "2026-05-09",
    "scheduledTime": "07:00",
    "venueName": "Canchas",
    "courtName": "Cancha 5",
    "courtId": "ecda5514-f76b-4e4a-aee2-e3cda117d3b2"
  },
  "score": {
    "scoreStringSide1": "6-3 7-6(5)",
    "scoreStringSide2": "3-6 6-7(5)"
  },
  "sides": []
}
```

The participant-focused pages display:

- `matchUpStatus`
- `winnerMatchUpId`
- `drawPositions`
- `drawPositionsRange.possibleDrawPositions`
- `schedule.scheduledDate`
- `schedule.scheduledTime`
- `eventName` or `drawName`
- `roundName`
- player side
- opponent side
- `schedule.venueName` and `schedule.courtName`
- score for the searched player side

The Date Matches page displays both sides for each matchup and uses the matchup score string when one is present.

### Side Objects

A matchup side represents one player in singles or one pair/team in doubles.

Singles side example:

```json
{
  "sideNumber": 1,
  "participantId": "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
  "participant": {
    "participantId": "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
    "participantName": "Player1",
    "participantType": "INDIVIDUAL"
  }
}
```

Doubles side example:

```json
{
  "sideNumber": 1,
  "participantId": "e7b59b73-fdf4-4d7e-b814-2ea78b6fe1f2",
  "participant": {
    "participantId": "e7b59b73-fdf4-4d7e-b814-2ea78b6fe1f2",
    "participantName": "Player1/Player2",
    "participantType": "PAIR",
    "individualParticipantIds": [
      "6a4a28ff-465e-4efa-9de5-9f6b817dc532",
      "dda688b7-818d-4309-968a-52dd7337e295"
    ]
  }
}
```

This distinction is important. If the user searches for `Player1`, the matching side in doubles may have the pair `participantId`, not Player1's individual `participantId`. The app checks both:

- `side.participantId`
- `side.participant.participantId`
- `side.individualParticipantIds`
- `side.participant.individualParticipantIds`
- `side.participant.individualParticipants[].participantId`

That logic prevents the app from treating the searched player's own doubles pair as the opponent.

### Potential Participants

Upcoming rounds can include unresolved or potential sides.

```json
{
  "potentialParticipants": [
    [
      {
        "participantId": "e7b59b73-fdf4-4d7e-b814-2ea78b6fe1f2",
        "participantName": "Player1/Player2",
        "individualParticipantIds": []
      }
    ]
  ]
}
```

The project also checks `potentialParticipants` when a matchup does not yet have fully assigned sides.

CourtHive may publish potential sides in two different useful shapes:

- Separate groups: one group for the searched participant's possible side and another group for the possible opponent side.
- Combined group: one group containing the searched participant's possible side and the possible opponent candidates.

The web pages preserve the top-level grouping first. If groups are separate, the app uses the group opposite the searched participant. If CourtHive sends one combined group, the app removes only the searched participant or searched pair and displays the remaining names joined with `or`.

For the Date Matches page, a matchup may have one known side and one unnamed placeholder side, while CourtHive sends a single `potentialParticipants` group for the unresolved side. In that shape the page assigns the single group to the unresolved side, so it can display `Player1/Player2 or Player3/Player4` instead of `TBD`.

### Draw Feeder Fields

Draw and schedule payloads can omit `potentialParticipants` for later future rounds. In those cases the Draw Viewer and Date Matches page use draw feeder fields when enough context is available:

```json
{
  "matchUpId": "current-matchup-id",
  "winnerMatchUpId": "next-matchup-id",
  "roundName": "Semifinal",
  "roundNumber": 6,
  "drawPositions": [
    92,
    104
  ],
  "drawPositionsRange": {
    "possibleDrawPositions": [
      65,
      66,
      67,
      68
    ]
  }
}
```

Important feeder concepts:

- `winnerMatchUpId` points from a feeder matchup to the next round.
- `drawPositions` identify the assigned draw positions for known sides.
- `drawPositionsRange.possibleDrawPositions` identifies the bracket range feeding a matchup.
- When both sides of a downstream matchup are unresolved, the Draw Viewer compares feeder matchups pointing to the same `winnerMatchUpId` and uses the selected path feeder as the selected side and the other feeder as the possible opponent side.
- When the Date Matches page has both feeder matchups in the schedule response, it uses the first feeder as Side 1 options and the second feeder as Side 2 options, sorted by draw position.

## Web Page Structure

The web page is located in:

```text
web/
```

Files:

```text
web/index.html
web/draw.html
web/date.html
web/styles.css
web/app.js
web/draw.js
web/date.js
web/robots.txt
```

### `index.html`

Defines the page layout:

- Tournament ID input
- Player name input
- Player lookup dialog
- Optional scheduled date input
- Find matches button
- Status panel
- Results area grouped by event
- Unofficial viewer disclaimer
- Navigation link to the Draw Viewer
- Navigation link to the Date Matches page

### `draw.html`

Defines the Draw Viewer layout:

- Tournament ID input
- Event type selector
- Player name input
- Player lookup dialog
- Display draw button
- Status panel
- Draw path result area
- Unofficial viewer disclaimer
- Navigation link to the Match Finder
- Navigation link to the Date Matches page

### `date.html`

Defines the Date Matches layout:

- Tournament ID input
- Required scheduled date input
- Show matches button
- Status panel
- `Courts` / `Events` view toggle
- Results area with a default court schedule grid and an event-grouped list option
- Unofficial viewer disclaimer
- Navigation links to the Match Finder and Draw Viewer

### `styles.css`

Defines the visual design and responsive layout:

- Main query panel
- Status band
- Event-specific result sections
- Match tables
- Date Matches court schedule grid
- Date Matches `Courts` / `Events` view toggle
- Player lookup dialog
- Mobile layout adjustments

### `app.js`

Contains the application logic:

- Calls CourtHive public endpoints with `fetch`
- Resolves a player name to a participant
- Loads the schedule data
- Detects matches involving the selected participant
- Handles pair/team participants correctly by checking `individualParticipantIds`
- Handles unresolved opponents from grouped `potentialParticipants`
- Falls back to draw-position inference when later `TO_BE_PLAYED` schedule rows do not have a directly assigned opponent
- Groups results by event name
- Renders result tables
- Provides a lightweight request cooldown
- Implements the Player lookup dialog

### `draw.js`

Contains the Draw Viewer logic:

- Calls `/factory/tournamentinfo` automatically to load tournament events
- Calls `/factory/participants` to resolve selected players and pair participants
- Calls `/factory/eventdata` for the selected event
- Recursively scans event data for matchup objects
- Filters matchups to the selected participant and follows unresolved `winnerMatchUpId` paths
- Handles doubles and mixed doubles by checking pair membership
- Handles downstream feeder matchups when a future round does not yet have assigned sides
- Derives possible opponents from `potentialParticipants`, opposite bracket halves, or opposite feeder matchups
- Displays the selected side, opponent, score, status, date, time, and court
- Uses a participant index so an event side with only a pair `participantId` can still match an individual player inside that pair

### `date.js`

Contains the Date Matches logic:

- Calls `/factory/scheduledmatchUps` with `params.matchUpFilters.scheduledDate`
- Recursively scans the schedule response for matchup objects
- Filters matchups to the selected scheduled date
- Deduplicates matchup objects that appear in multiple response locations
- Displays time, court, status, round, both sides, and score
- For unresolved future matches, uses upstream feeder matchups to show options such as `Player1 or Player2` instead of `TBD` when the response includes enough bracket context
- When CourtHive sends one unnamed side plus a single `potentialParticipants` group, assigns that option group to the unresolved side
- Defaults to a court schedule grid with courts as columns and times as rows
- Supports switching to results grouped by event name

### `robots.txt`

Prevents search engines from indexing the deployed page:

```text
User-agent: *
Disallow: /
```

## Languages And Technologies

This project is intentionally simple and does not require a build step.

Languages and tools:

- HTML for page structure
- CSS for styling and responsive layout
- JavaScript for API calls and UI behavior
- Bash for the original command-line script
- `curl` and `jq` for the shell script implementation

Because the web page is static, it can be hosted on static hosting providers such as Netlify Drop, GitHub Pages, Cloudflare Pages, or Vercel.

## Functionality

The Match Finder supports this workflow:

1. Enter a tournament ID.
2. Type a player name or use the Player lookup dialog.
3. Optionally select a scheduled date.
4. Fetch CourtHive public matchups.
5. Display matches grouped by event type.
6. For unresolved future matches, show possible opponent candidates when CourtHive publishes enough draw or potential participant data.

The Draw Viewer supports this workflow:

1. Enter or keep the tournament ID.
2. Wait for the published event list to load automatically.
3. Select an event type from the event list.
4. Type a player name or use the Player lookup dialog.
5. Click `Display draw`.
6. Review the participant's draw path for the selected event.

The Date Matches page supports this workflow:

1. Enter or keep the tournament ID.
2. Keep the default local date or select another scheduled date.
3. Click `Show matches`.
4. Review all published matchups for that date in the default court schedule grid.
5. Switch to `Events` to review the same matches grouped by event.

Match Finder result rows show:

- Match status
- Scheduled date
- Scheduled time
- Round
- Player or pair side
- Opponent side
- Court
- Score

Date Matches court-grid cells show:

- Event name
- Match status
- Round
- Side 1
- Side 2
- Score when present

The Date Matches `Events` view uses the same row fields as the court grid, with time and court shown as columns.

The opponent logic handles both singles and doubles. For example, if the user searches for an individual player who is part of a doubles pair, the app identifies the player's pair as the player side and shows the opposing pair as the opponent.

The Draw Viewer uses the same opponent logic. It additionally builds a participant index from `/factory/participants` so draw data can be matched even when the event payload references a pair participant without embedding the individual players directly in the side object.

When an upcoming match does not yet have a decided opponent, the web pages read grouped `potentialParticipants` from the matchup payload. In the Match Finder and Draw Viewer, if CourtHive provides separate groups for each side, the apps use the group opposite the searched participant. If CourtHive provides one combined group, the apps remove only the searched participant and display the remaining candidate opponent names joined with `or`, for example `Player1 or Player2`.

In Date Matches, there is no searched participant. When an unresolved matchup has one known side and one single potential group, the page treats that group as the missing side's options. When both sides are unresolved and two feeder matchups are available, it shows each feeder's possible winners as the two side option groups.

For later future rounds, such as a second `TO_BE_PLAYED` match, the Draw Viewer can continue beyond the current matchup by following `winnerMatchUpId`. If the downstream match has no assigned sides, it displays the selected participant's feeder side as possible winners and derives the opponent from the opposite feeder. The Date Matches page can also use feeder matchups when the schedule response contains them. For example:

```text
Player1 or Player2 vs Player3 or Player4
```

## Player Lookup Feature

The Player lookup feature helps users select a valid participant name instead of manually typing it.

### Purpose

The main search box accepts free text, but player names and pair names must match published CourtHive participant data closely enough to resolve to a `participantId`. The lookup dialog reduces typing mistakes by loading the tournament's published participant list and letting the user select an exact participant name.

### User Flow

1. Enter or keep the tournament ID.
2. Click the `Lookup` button next to the Player name input.
3. The app calls `/factory/participants` for the current tournament.
4. The dialog displays a searchable list of published participants.
5. Type part of a player or pair name to filter the list.
6. Click a participant row.
7. The selected participant name is inserted into the Player name input.
8. Click `Find matches` to run the matchup search.

### Data Source

The lookup dialog uses:

```http
POST /factory/participants
```

Payload:

```json
{
  "params": {
    "tournamentId": "<tournamentId>"
  }
}
```

The dialog reads the returned `participants` array and converts each participant into a local option:

```json
{
  "id": "<participantId>",
  "name": "Player1",
  "type": "INDIVIDUAL"
}
```

Pair participants are also shown:

```json
{
  "id": "<pairParticipantId>",
  "name": "Player1/Player2",
  "type": "PAIR"
}
```

### Matching Behavior

Filtering is performed locally in the browser after the participant list is loaded. The filter:

- Normalizes diacritics.
- Converts text to lowercase.
- Matches partial names.
- Supports both individual player names and pair names.
- Limits the displayed results to the first 80 matches to keep the dialog responsive.

The lookup list is cached in memory for the current tournament ID. If the tournament ID changes, the app reloads participants from CourtHive.

### Selection Behavior

When the user clicks a lookup result:

- The participant's display name is copied into the Player name input.
- The dialog closes.
- The status message confirms the selected name.

The app still resolves the selected name again during `Find matches`, so the main search flow remains the same whether the name was typed manually or chosen from lookup.

## LLM Handoff Notes

This section is written for future AI assistants or developers who need to understand or modify the project without rediscovering the CourtHive behavior.

### Core Goal

The project answers two related user questions:

```text
Given a CourtHive tournament and a player or pair name, show that participant's matches, opponents, schedule, court, and score.

Given a CourtHive tournament and date, show the full published court schedule for that day.
```

The implementations should stay aligned where their responsibilities overlap:

- `scripts/find_upcoming_matches.sh` is the command-line version.
- `web/app.js` is the browser version.
- `web/draw.js` is the browser draw-path version and has additional feeder logic that the shell script does not currently implement.
- `web/date.js` is the browser date-schedule version and has full-day display logic that is not participant-specific.

When behavior changes in one implementation, check whether the same logic should be copied to the others. Match Finder and Draw Viewer now share most participant and opponent rules, but Draw Viewer has extra draw-path behavior based on `/factory/eventdata`. Date Matches shares the scheduled-matchup parsing and future-side inference rules, but renders a full-day schedule rather than a participant path.

### Required API Rules

Use these endpoint shapes unless the CourtHive API changes:

```http
POST https://courthive.net/factory/participants
```

```json
{
  "params": {
    "tournamentId": "<tournamentId>"
  }
}
```

```http
POST https://courthive.net/factory/scheduledmatchUps
```

```json
{
  "params": {
    "tournamentId": "<tournamentId>",
    "noCache": true,
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
```

For date filtering, always use `matchUpFilters.scheduledDate`:

```json
{
  "params": {
    "tournamentId": "<tournamentId>",
    "noCache": true,
    "matchUpFilters": {
      "scheduledDate": "YYYY-MM-DD"
    },
    "hydrateParticipants": true,
    "nextMatchUps": true
  }
}
```

Do not send the date as `params.scheduledDate`; that shape may not filter correctly.

For event draw data, use:

```http
POST https://courthive.net/factory/tournamentinfo
```

```json
{
  "tournamentId": "<tournamentId>"
}
```

```http
POST https://courthive.net/factory/eventdata
```

```json
{
  "tournamentId": "<tournamentId>",
  "eventId": "<eventId>",
  "hydrateParticipants": true,
  "usePublishState": true,
  "noCache": true
}
```

### Participant Resolution

The first step is resolving a user-entered name to a participant:

1. Call `/factory/participants`.
2. Search `participants[]`.
3. Compare against `participantName`.
4. For individuals, also compare against `person.standardGivenName` and `person.standardFamilyName`.
5. Normalize strings for case and diacritics.

The resolved value needed for match filtering is the participant's `participantId`.

### Matchup Discovery

The `/scheduledmatchUps` payload can contain matchups in several places, including nested court data. The project scans recursively for objects that look like matchups:

- object has `matchUpId`
- and has fields such as `sides`, `potentialParticipants`, `roundName`, or `eventName`

The browser version keeps the best object for each `matchUpId` before rendering. This matters because the same `matchUpId` can appear more than once in the response, sometimes with different hydration completeness. Prefer the object with richer fields such as side names, schedule, score, and potential participants.

The Draw Viewer applies the same recursive scan to `/eventdata`. Event payloads can nest matchups under draw structures, round matchup collections, or direct matchup arrays. The page should not assume one fixed path such as `eventData.drawsData[0].structures[0].roundMatchUps`; instead, it scans for objects with `matchUpId` and keeps the most complete version of each matchup.

### Date Matches Behavior

The Date Matches page is a schedule view, not a participant search. It calls `/scheduledmatchUps` with `params.matchUpFilters.scheduledDate`, extracts all matchup objects for the selected date, and renders the same rows in two interchangeable views.

The default view is `Courts`:

- columns are courts, using `schedule.venueName / schedule.courtName`
- rows are scheduled times, using `schedule.scheduledTime`
- each cell can contain one or more match cards
- untimed matches use `-` as their time and sort after real times

The alternate view is `Events`:

- rows are grouped by `eventName || drawName || "-"`
- the table shows time, court, status, round, both sides, and score

Date Matches must not assume that `sides[0]` is Side 1 and `sides[1]` is Side 2. CourtHive can send placeholder side objects without `sideNumber` or `participantName`. The page first builds two side slots using `sideNumber` or `displaySideNumber`, then fills missing slots with unnamed placeholder sides. This preserves cases where Side 2 is known and Side 1 is unresolved.

For unresolved Date Matches sides:

- prefer direct side names from `side.participant.participantName` or `side.participantName`
- if both feeder matchups are available, use feeder side names sorted by draw position
- if one side is unresolved and CourtHive sends one `potentialParticipants` group, assign that group to the unresolved side
- otherwise use the potential group matching the side index
- only show `TBD` when no direct side, feeder names, or potential participant names are available

This behavior is needed for schedules such as May 31, 2026 in the default tournament, where some semifinals contain one known side plus a single potential group for the unresolved opponent side.

### Draw Viewer Behavior

The Draw Viewer is intentionally user-focused instead of attempting to recreate the full CourtHive bracket UI. For the selected event and participant, it shows the participant's draw path: direct participant matchups, current unresolved matchups, and downstream future matchups that can be reached by following feeder relationships.

For unresolved future rounds, the Draw Viewer also follows `winnerMatchUpId` from the selected participant's current `TO_BE_PLAYED` matchup. This lets the page display the next possible round even before the selected participant is assigned to that downstream matchup. In that case, the selected side is shown as the possible winners from the feeder matchup, for example `Player1/Player2 or Player3/Player4`.

If a downstream matchup has two unresolved feeders, such as a final fed by two semifinals, the Draw Viewer uses the selected path feeder for the selected side and the opposite feeder for the opponent side. This avoids showing `Opponent TBD` when the possible opponent side can be derived from the other feeder matchup.

Draw-path expansion should only continue speculatively from unresolved statuses such as `TO_BE_PLAYED`, `SCHEDULED`, or `IN_PROGRESS`. Completed or defaulted matchups should not be followed speculatively unless CourtHive already references the selected participant in the downstream match.

Each draw card shows:

- Round
- Match status
- Selected side
- Opponent
- Score
- Scheduled date
- Scheduled time
- Court

This format is easier to maintain in a static page and avoids depending on private CourtHive frontend components.

### Opponent Detection

This is the most important project-specific rule.

Do not decide the opponent by simply checking whether `side.participantId !== searchedParticipantId`.

That fails for doubles, because a searched individual player can be inside a pair participant. In that case:

- searched player participant ID: `<individualParticipantId>`
- pair side participant ID: `<pairParticipantId>`
- pair side contains individual IDs in `individualParticipantIds`

To decide whether a side is the searched participant's side, check all of these locations:

- `side.participantId`
- `side.participant.participantId`
- `side.individualParticipantIds`
- `side.participant.individualParticipantIds`
- `side.participant.individualParticipants[].participantId`

Only after identifying the searched participant's side should the app choose the other side as the opponent.

The same rule applies to `potentialParticipants` when future rounds do not have fully assigned sides yet.

When using `potentialParticipants`, preserve the top-level grouping before flattening. A future matchup can contain one group for the searched participant's possible side and another group for the possible opponent side. Flattening everything too early makes the app unable to distinguish the searched player's own side from the possible opponents.

If CourtHive sends one combined `potentialParticipants` group, do not discard the whole group just because it contains the searched participant. Remove only the searched participant or searched pair from that group, then display the remaining participant names as possible opponents.

The Draw Viewer has additional fallbacks because `/factory/eventdata` can omit `potentialParticipants` for future draw rounds:

- For a current future matchup with one assigned side, use `drawPositionsRange.possibleDrawPositions` to split the current matchup into two bracket halves, identify the half containing the selected participant's draw position, then read the previous-round matchup from the opposite half to display possible opponent names.
- For a downstream matchup with no assigned sides, find feeder matchups where `winnerMatchUpId` equals the downstream `matchUpId`; the feeder on the selected path becomes the selected side, and the other feeder becomes the possible opponent side.
- For feeder names, prefer assigned `sides[].participant.participantName`; if no sides are assigned, fall back to names from `potentialParticipants`.

### Score Detection

Scores are side-based, not participant-name-based.

Use `score.scoreStringSide1` when the searched participant is on `sides[0]`.

Use `score.scoreStringSide2` when the searched participant is on `sides[1]`.

If the match has no score or no two-sided structure, display an empty score or `-`.

Date Matches is not participant-specific, so it should prefer `score.scoreString` when present and otherwise fall back to side-specific score strings. If no score exists, display `-`.

### Results Presentation

The Match Finder groups rows by event name. This is a display feature only; it should not change the underlying matching logic.

A row's event label comes from:

```text
eventName || drawName || "-"
```

The Date Matches page defaults to a court schedule grid, but can switch to the same event-grouped presentation. The view toggle should only affect rendering. It should not trigger a new API request or alter the extracted row data.

### Browser Hosting Notes

The web page is static and can be hosted without a backend. CourtHive currently allows browser CORS requests to the public factory endpoints.

The page uses:

- `fetch` for API calls
- no build tools
- no package manager
- no analytics
- no local storage

Script tags use query-string versions such as:

```html
<script src="./app.js?v=..."></script>
```

Update that value after meaningful JavaScript changes so deployed static hosts and browsers do not serve stale code. The Draw Viewer and Date Matches page have their own versioned script tags:

```html
<script src="./draw.js?v=..."></script>
<script src="./date.js?v=..."></script>
```

### Common Failure Modes

If no participants load:

- Participants may not be publicly published.
- The tournament ID may be wrong.
- CourtHive may be unavailable.

If matches show but opponents are wrong:

- Recheck the doubles side detection logic.
- Make sure `individualParticipantIds` is being inspected.
- Make sure duplicate `matchUpId` rows preserve the richer object before rendering.
- Make sure grouped `potentialParticipants` are not flattened too early.
- If one combined `potentialParticipants` group contains the searched participant, remove only the searched participant, not the whole group.
- For Draw Viewer future rounds, inspect `winnerMatchUpId`, feeder matchups, and `drawPositionsRange.possibleDrawPositions`.

If the Draw Viewer shows `Opponent TBD` for a later future round:

- Check whether the downstream matchup has assigned sides.
- If not, find matchups where `winnerMatchUpId` equals the downstream `matchUpId`.
- Identify which feeder is on the selected participant's path.
- Use the other feeder's side names as possible opponents.

If Date Matches shows `TBD` for a future match:

- Check whether the matchup has one known side and one unnamed placeholder side.
- Check whether `potentialParticipants` contains one group; if so, it should be assigned to the unresolved side.
- Check whether feeder matchups exist in the same `/scheduledmatchUps` response where `winnerMatchUpId` equals the future matchup's `matchUpId`.
- Confirm feeder options are sorted by draw position before assigning them to Side 1 and Side 2.

If Date Matches does not show the expected court grid:

- Confirm the `Courts` radio option is checked.
- Confirm rows have `schedule.courtName`; rows without a court are grouped under `-`.
- Confirm rows have `schedule.scheduledTime`; untimed rows are grouped under `-` and sorted after real times.
- Confirm switching between `Courts` and `Events` only calls the local render path and does not make another API request.

If date filtering does not work:

- Confirm the payload uses `params.matchUpFilters.scheduledDate`.
- Confirm `noCache: true` is present.
- Confirm the date is `YYYY-MM-DD`.

If a deployed web page behaves differently than local files:

- Clear browser cache.
- Bump the relevant `app.js?v=...`, `draw.js?v=...`, or `date.js?v=...` query string.
- Redeploy the entire `web/` folder.

### Privacy And Publishing Notes

The app intentionally avoids adding analytics, persistent storage, or a backend proxy. If any future version adds these, update this documentation and reassess privacy risk.

## Safeguards

The web page includes several publishing safeguards:

- `noindex, nofollow` metadata
- `robots.txt` disallowing indexing
- Referrer suppression
- Content Security Policy restricted to local assets and `https://courthive.net`
- Unofficial viewer disclaimer
- Client-side search cooldown
- No analytics
- No local storage of searches or results

## Limitations

The page depends on CourtHive public API availability and published tournament data. If participants, schedule data, event data, draw positions, or feeder relationships are not published, the API may return no records, an error, or insufficient data to infer possible opponents.

The project does not authenticate with CourtHive and does not access private tournament data.
