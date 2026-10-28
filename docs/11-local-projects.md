# Local projects: many designs kept in this browser

Status: spec and implementation on branch `projects`, 2026-10-28; QA round 1 fixed (two blockers, seven majors, the minors), with a randomized two-tab test (section 11). Owner's decision: no accounts and no server for now; the share link stays the way to hand a design to someone else. Fits `docs/07` (Dialog, Sheet, tokens, the phone's More sheet), `docs/09b` (each design carries its own build) and `docs/10` (the counts' schema, the privacy promise).

## 0. Decisions

1. **Projects live in this browser only**, in IndexedDB, like the part library. Nothing is sent anywhere. Where IndexedDB is missing or refuses (a private window), the list lives in memory for the session and says so.
2. **A project is a named design.** Its name is the design's name: renaming either renames both. A project holds the design as a `.json` design file object (`designFileObject`, the format of File, Save as Smith Online), so a project, an exported project and a saved file are the same thing.
3. **The open project follows the design on show.** Every change is written back to it (after a short pause), as the autosave is. New, Open, an example, a lesson or a link start an unsaved design until **Save to projects**.
4. **The autosave stays.** It still holds the design on show at full precision, so a crash or a refused write never loses work. The projects add a list beside it; they do not replace it.
5. **Undo is about designs, not about the list.** Opening a project is one step: Undo brings back the previous design, and with it the project it belonged to (or unsaved). Delete in the list has its own Undo in the list and its toast.
6. **Never lose a design, never refuse one the app wrote.** A record this version cannot read is listed, never dropped or overwritten; it can be exported or deleted by the user. Every write of a record is checked against the version this tab knows (section 4); a write another tab overtook is never forced: both designs are kept. Every file Export all writes imports again.

## 1. Where projects live

- IndexedDB database `smithonline-projects`, object store `projects`, key `id`. One record per project.
- Opening waits at most 5 s (as the part library). Blocked by another tab or no answer: memory for now, and the list says "Projects stored in this browser could not be read: another tab may hold them. Close it and reload."
- No IndexedDB, or it refuses to open: memory, and the list says "This browser does not let the app store projects (a private window?): they last until the page is closed. Export all keeps them as a file."
- A write refused for space (`QuotaExceededError`) marks the list **full**: "This browser has no room for more projects. Export all keeps them as a file; delete some to make room." Any other refused write marks it **refused**, with the private window text. The design on show is untouched in both cases, and the autosave still holds it. A refused write-back of the open project says so once in the status line ("Not saved to project "X": browser storage is full. The autosave keeps your design; ...") and the chip reads **Not saved** until a write goes through.
- Another tab opening the database at a later version closes this tab's connection (`versionchange`); the next use opens it again.
- The open project's id is kept beside the autosave in `localStorage` (`smithonline.projects.open`, `{ id, at, lean? }`): `at` is the project's modified time the autosaved design is based on (the version this tab last wrote or read when it wrote that autosave), `lean` marks an autosave written without its parts' data. The mark is written only with its autosave: it is removed before each autosave and written after it, so a failure between the two leaves the design unsaved rather than linked to the wrong project, and a write-back never re-dates it (the autosave may be another tab's by then).

## 2. The project model

| Field                 | What it is                                         | Read rule                                                                        |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                  | random, `p-` and 16 hex digits                     | string of 1 to 64 letters, digits and `-`; else the record is skipped            |
| `name`                | the design's name                                  | string, cut to 200 characters; else "Untitled"                                   |
| `created`, `modified` | ms since 1970                                      | finite and positive; else 0                                                      |
| `file`                | `{ app: 'Smith Online', version: 1, design }`      | `app` and a string `design` up to the size limit; else the record is skipped     |
| `thumb`               | SVG path of the network's trace on the unit circle | only `M`, `L`, digits, `.`, `-` and spaces, up to 4000 characters; else left out |
| `appVersion`          | the version that last wrote it                     | `n.n.n`; else left out                                                           |

- Records are read with the checks above; the design itself is read only when it is opened, with the reader of File, Open (`designFromJsonFile`). A record that passes the checks but whose design does not read is shown as "This version cannot open it" with Export and Delete; it is never rewritten.
- Skipped records (not an object, no id, no file) are counted, and the list says "N stored records could not be read and are left as they are". They stay in the database.
- The thumbnail is the network's trace at the design frequency (the load, then each element's arc), drawn in a 2 by 2 box. It is computed when the project is written, about a millisecond.

## 3. The list

**Where:** File, **Projects…** (desktop and tablet); More, Data, **Projects** on a phone. Settings, Data in this browser, has a line "Projects: N" with **Manage…** (closing the list goes back there, with the focus on Manage…). The dialog is the app's Dialog: a full-screen sheet on a coarse pointer. It opens with the focus on the search field (on the first button while the list is empty, or when Save to projects opened it).

**Head:** a search field (matches the name, case-insensitive), the sort (a radio group: **Modified**, newest first, or **Name**, in natural order: "X (copy)" before "X (copy 2)", "2" before "10"; the choice is remembered in `smithonline.projects.sort`), **Save to projects** (primary while the design on show is unsaved; disabled until the list is read), **Import .json…**.

**Rows:** the thumbnail, the name (one line, cut with an ellipsis, the whole name in its tooltip), "Modified 28 Oct 2026, 21:05", "Open now" on the open project, "This version cannot open it: reason" on an unreadable one (the reason is also the tooltip of its disabled Open). **Open** as the row's button; a **More actions** menu with Rename, Duplicate, Export .json and Delete.

**Status:** the dialog's status line is the one live region while the list is open; a later action clears a stale message. What it said last goes to the app's status line when the list closes, with its Undo for another 8 s.

- **Save to projects:** an untitled design (the name "Untitled" or empty) is asked for a name first, in a field under the head. When a project in the list holds exactly the design on show (opened from an exported file), it offers **Use that project** (the design on show is linked to it, no new step and no new project) or **Save a copy**. From File and the chip the same questions open the list.
- **Open:** the pending write-back of the open project is flushed first, and the project is read from the store (another tab may have written it since the list was read). When no stored project holds the design on show (it is unsaved, a write-back was refused or too large, or another tab changed or deleted its project) and it holds a network, the design itself is kept as a backup ("replaced", shown in Settings, Data in this browser, as "the design that was open before"): not the autosave, which another tab may have written since. The design opens as one Undo step: "Opened project "X". Undo brings back the previous design." Opening the open project just closes the list.
- **Rename:** an inline field with the name selected; Enter commits, Escape cancels. On the open project it is the design's rename (one Undo step, as in the header). Any other project is read from the store just before and that record is renamed (never this tab's older copy). Empty names are refused; an unreadable project cannot be renamed.
- **Duplicate:** "X (copy)", then "X (copy 2)", of the stored record, with created and modified now. The base is cut so the name with its suffix fits 200 characters; the search ends after at most one name per project. It does not open.
- **Delete:** at once for any project but the open one (or one whose last write-back was refused), which asks first ("It is the design on show: it stays, unsaved, and Undo puts the project back"; the focus on Cancel). It waits for a write-back on its way, so the record Undo puts back is the latest. The list's status line, then the app's status line or toast, offer **Undo** for 8 s: the record comes back with its id, dated now. When another tab had written that record last, a design here linked to it is not written over it (the next write-back keeps both). Deleting the open project leaves the design on show, unsaved.
- **Export .json:** the project's design file, `name.json`, as File, Save as Smith Online writes it.
- **Export all:** in the footer, `smithonline-projects-2026-10-28.json`: `{ app: 'Smith Online', kind: 'projects', version: 1, projects: [{ name, created, modified, file }] }`, every project as stored, the unreadable ones too. When the file would pass 90 MB, it is split in numbered files (`...-part-1-of-3.json`), each a whole Export all file under the import limit. The status names the files, and the footer says when Export all last ran in this browser (`smithonline.projects.exported`).
- **Import .json…:** one or many files. A design file becomes one project, a projects file one project per entry (their names and times kept). A Smith Online file from a later version is kept as an unreadable project ("kept to open in a later version"), a damaged one too ("damaged, kept as it is"), neither refused; a file that is not a Smith Online file is refused with its reason. A project already in the list (same name and same design) is skipped. An entry's design is decoded only when it is added, so a file of many thousand entries reads quickly. File, Open on a projects file says to import it in Projects.

**Empty list:** "No projects yet. Save to projects keeps the design on show here; Import .json adds saved files."

## 4. The design on show and its project

- The header's design strip shows, after the name, a quiet chip with a word: **Saved** (the project's name in its tooltip), **Unsaved**, or **Not saved** (the browser refused the last write-back; the tooltip says why). It opens the list. At 1440 to 1599 px the name field is 64 px (the whole name in its tooltip), so the header stays one 48 px row. On a phone the same chip is in the design sheet, More carries a dot while the design on show holds a network no project holds or its last write was refused, and More, Data, Projects says "Saved: X", "Not saved: X" or "Unsaved: this design is not in projects".
- **One checked write.** Every write of a record (write-back, save, rename, duplicate, Undo of a delete, import, migration) goes through one function: the store writes it in one transaction only when the stored record's `modified` is still the one this tab knows (it last wrote or read), or, for a new record, only when nothing is stored under its id. Writes run one at a time in a tab. A refusal by the browser is reported, never retried over.
- **Write-back:** after each change to the design on show, 0.5 s later, its file is written to the open project when its text differs from the list's copy; `modified` (now, and later than both the stored and the known time) and the thumbnail are updated. A pending write is flushed when the list opens a project and when the page is hidden. A design whose library parts came without their data (a lean autosave) first takes the data from its project, so a write-back never strips it.
- **Overtaken:** when another tab wrote the project since, nothing is written over it: the design on show is kept beside it as a new project, "X (from this tab)" (then "(from this tab 2)"), the design takes that name and stays linked to it, and the status line says "Project "X" was changed in another tab, so your design here is kept beside it as a new project, "X (from this tab)". Both are in the list." When that write is refused too, the design turns unsaved and the status line says so; the autosave holds it.
- **Deleted elsewhere:** a write-back to a project another tab deleted is not made: the design turns unsaved and the status line says "Project "X" was deleted in another tab; your design is unsaved here now (the autosave keeps it)."
- **Unreadable:** a linked project whose design this version cannot read (a later version wrote it) is never written over: the design turns unsaved and the status line says so.
- **At start:** the autosave opens as today, linked to the project of the mark. When the list is read: no such project, the design is unsaved and the status line says so; a lean autosave takes its parts' data from the project, and says so; then the write-back rules above: the same content, nothing to do; the project still the version in the mark, the autosave (newer) is written to it; changed since, both are kept.
- **New, Open, examples, lessons, workflows, a link:** an unsaved design. **Save to projects** (File, the list, the chip) makes it a project and links the design on show and the steps of Undo since it was opened or started. A link opened over a project says the previous design stays in File, Projects.
- **Undo across opening a project:** each design in the history remembers its project. Undo after opening B shows A again, linked to A (or unsaved); Redo shows B, linked to B. Writes follow the design on show, so B keeps the state it had when you stepped back.

## 5. Migration

Once, when the list is first read in a browser that stores projects, it is empty and `smithonline.projects.migrated` is not set: the autosave read at the start (when it reads) becomes the first project, with its name, and the status line says "Your design "X" is now the first project in File, Projects; changes are saved there as you work." When that design is the one on show, it is the open project. When a link opened over it, the project is made and the link's design stays unsaved. A tab claims the migration in the flag ("claim", a time and a random id) before it reads the list again; it migrates only when its claim still stands and the list is still empty, so two tabs starting together make one project (the other tab links its design to that project when it holds the same design). A claim older than a minute is taken over. The flag is set to `1` once the write succeeds (a refused write gives the claim back); without storage nothing is migrated and nothing is set. A non-empty list is never migrated into.

## 6. Limits

- **500 projects.** Save to projects, Duplicate and Import refuse past it: "The list holds 500 projects at most: export and delete some to make room." Writing back to the open project is never refused for the count.
- **20 MB per project** (characters of the design file; a design with several large part files). Save and import refuse a larger one; a write-back that would pass it is not made, the project keeps its last version and the status line says so once ("too large for the project list; File, Save as Smith Online keeps it as a file"). The autosave still holds the design.
- **Import:** files up to 128 MB: above one part of Export all (90 MB) and above the largest project as a file (20 MB of design, at most six times that when escaped).
- **Names and times:** a name loses C0 and C1 controls and line separators (a space for a run of them) and direction marks, overrides and isolates. A modified time past 10^13 ms (the year 2286) reads as unknown (0).

## 7. Privacy

Projects stay in this browser and are sent nowhere: not to the counts, not with feedback (which attaches only the design on show, when ticked). Clearing the site's data in the browser deletes them, as it deletes the autosave and the part library. A private window keeps them until it closes. **Export all** is the backup: one file with every project, which Import puts back in any browser.

## 8. Usage counts

A new event `project` in the schema (docs/10 section 1.3), counts only, never names or content:

| Event     | a                                                                                            | b                                                                   |
| --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `project` | `open`, `save`, `duplicate`, `delete`, `rename`, `import`, `export`, `export_all`, `migrate` | count bucket `1`, `2-5`, `6-20`, `21+` (import, export all, delete) |

`error` gains `projects` (a write refused by the browser, at most five a page load).

## 9. Files

- `lib/projectStore.ts`: the record checks, the memory and IndexedDB stores, quota and refusal, the thumbnail, the export file.
- `store/useProjects.ts`: the list, the one checked write (`commit`, one write at a time), write-back, keeping both on a conflict, migration, import, the open marker.
- `store/projectStanding.ts`: Saved, Unsaved or Not saved, for the chip and the phone's mark on More.
- `store/useDesignStore.ts`: `projectId`, the project of each design in the history, `loadDesign(design, label, project)`, `adoptProject`.
- `components/ProjectsDialog.tsx`, `components/ProjectChip.tsx`; File, Projects… and Save to projects; More, Data, Projects; Settings line.

## 10. QA checklist

1. Save to projects, edit, reload: the project opens, linked, with the edit.
2. Open another project; Undo: the first design and its project; Redo: the second.
3. Rename in the list and in the header: both names follow; Undo of a header rename renames the project back.
4. Duplicate (also of a 200-character name), Delete with Undo (dialog, then the status line or toast after the list is closed), deleting the open project asks first and leaves an unsaved design.
5. Export one opens with File, Open; Export all then Import into an empty browser gives the same list; importing it again skips every project.
6. A hostile record (no id, a number for `file`, a script in the name, a path with other letters in `thumb`): skipped or cleaned, never rendered as markup.
7. An unreadable record: listed, Export works, Open says why, nothing rewrites it.
8. Quota: a refused write keeps the design on show and the autosave, says so, and the chip reads Not saved; opening another project then keeps a backup; private window: the memory note.
9. Two tabs on one project: the second write keeps both ("X (from this tab)") with the message; a rename or an Undo of a delete in a tab whose list is older does not write over the other tab's edits; a lean autosave never strips part data.
10. Migration once, with its message: the autosave becomes the first project; a second start, or a second tab starting at once, adds nothing.
11. Desktop 1440 x 900 and phone: the list, its actions, the chip and More, Data, Projects; keyboard and Escape.
12. Save to projects of an untitled design asks for a name; of a design a project holds offers that project.

## 11. The randomized two-tab test

`test/d11-projects-interleave.test.ts` runs two tabs (each its own copy of the app's modules) over one shared store and one localStorage, with random edits, Undo and Redo, opens, saves, renames, duplicates, deletes and their Undo, write-backs, refused writes, lean autosaves and tabs closed (with or without a last write-back) and opened again from the autosave, two actions at once part of the time. Every design carries a stamp. It checks that no write replaces a stored design the writing tab never had on show, that no write strips a project's part data, that every design that reached storage ends up in a project, the autosave or a backup (unless the user deleted its project or the same line of edits went on from it), that a design replaced by Open is kept, and that a tab's linked design is in its project after a last write-back. 12 seeds of 90 steps run with the tests; `IL_SEEDS`, `IL_STEPS` and `IL_FROM` run more (40 seeds of 200 steps passed three times). Run on the code before these fixes, 30 seeds of 200 steps found 5 blind overwrites and many designs lost on Open.

Known limits, unchanged: the autosave is one per browser, so two tabs with unsaved designs share it (the last to write wins); a tab learns that another tab changed or deleted its project only on its next write.
