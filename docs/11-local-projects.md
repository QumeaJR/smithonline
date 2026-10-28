# Local projects: many designs kept in this browser

Status: spec and implementation on branch `projects`, 2026-10-28. Owner's decision: no accounts and no server for now; the share link stays the way to hand a design to someone else. Fits `docs/07` (Dialog, Sheet, tokens, the phone's More sheet), `docs/09b` (each design carries its own build) and `docs/10` (the counts' schema, the privacy promise).

## 0. Decisions

1. **Projects live in this browser only**, in IndexedDB, like the part library. Nothing is sent anywhere. Where IndexedDB is missing or refuses (a private window), the list lives in memory for the session and says so.
2. **A project is a named design.** Its name is the design's name: renaming either renames both. A project holds the design as a `.json` design file object (`designFileObject`, the format of File, Save as Smith Online), so a project, an exported project and a saved file are the same thing.
3. **The open project follows the design on show.** Every change is written back to it (after a short pause), as the autosave is. New, Open, an example, a lesson or a link start an unsaved design until **Save to projects**.
4. **The autosave stays.** It still holds the design on show at full precision, so a crash or a refused write never loses work. The projects add a list beside it; they do not replace it.
5. **Undo is about designs, not about the list.** Opening a project is one step: Undo brings back the previous design, and with it the project it belonged to (or unsaved). Delete in the list has its own Undo in the list and its toast.
6. **Never lose a design.** A record this version cannot read is listed, never dropped or overwritten; it can be exported or deleted by the user. A write that another tab overtook is not forced: the design on show turns unsaved and says so.

## 1. Where projects live

- IndexedDB database `smithonline-projects`, object store `projects`, key `id`. One record per project.
- Opening waits at most 5 s (as the part library). Blocked by another tab or no answer: memory for now, and the list says "Projects stored in this browser could not be read: another tab may hold them. Close it and reload."
- No IndexedDB, or it refuses to open: memory, and the list says "This browser does not let the app store projects (a private window?): they last until the page is closed. Export all keeps them as a file."
- A write refused for space (`QuotaExceededError`) marks the list **full**: "This browser has no room for more projects. Export all keeps them as a file; delete some to make room." Any other refused write marks it **refused**, with the private window text. The design on show is untouched in both cases, and the autosave still holds it.
- The open project's id is kept beside the autosave in `localStorage` (`smithonline.projects.open`, `{ id, at }`, `at` the project's modified time this tab last wrote or read). It is removed before each autosave and written after it, so a failure between the two leaves the design unsaved rather than linked to the wrong project.

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

**Where:** File, **Projects…** (desktop and tablet); More, Data, **Projects** on a phone. Settings, Data in this browser, has a line "Projects: N" with **Manage…**. The dialog is the app's Dialog: a full-screen sheet on a coarse pointer.

**Head:** a search field (matches the name, case-insensitive), the sort (**Modified**, newest first, or **Name**, A to Z), **Save to projects** (primary while the design on show is unsaved), **Import .json…**.

**Rows:** the thumbnail, the name, "Modified 28 Oct 2026, 21:05", "Open now" on the open project, "This version cannot open it" on an unreadable one. **Open** as the row's button; a **More actions** menu with Rename, Duplicate, Export .json and Delete.

- **Open:** the pending write-back of the open project is flushed first. When the design on show is unsaved and holds a network, its autosave is kept as a backup ("replaced", as for a link) before the project opens, so Settings, Data in this browser, opens it again. The design opens as one Undo step: "Opened project "X". Undo brings back the previous design." Opening the open project just closes the list.
- **Rename:** an inline field; Enter commits, Escape cancels. On the open project it is the design's rename (one Undo step, as in the header). Empty names are refused; an unreadable project cannot be renamed.
- **Duplicate:** "X (copy)", then "X (copy 2)", with created and modified now. It does not open.
- **Delete:** at once, no question; the status line and the toast offer **Undo** for 8 s, which puts the record back with its id (the open project is linked again). Deleting the open project leaves the design on show, unsaved.
- **Export .json:** the project's design file, `name.json`, as File, Save as Smith Online writes it.
- **Export all:** in the footer, `smithonline-projects-2026-10-28.json`: `{ app: 'Smith Online', kind: 'projects', version: 1, projects: [{ name, created, modified, file }] }`, every project as stored, the unreadable ones too.
- **Import .json…:** one or many files. A design file becomes one project, a projects file one project per entry (their times kept). A Smith Online file this version cannot read is kept as an unreadable project, not refused; a file that is not a Smith Online file is refused with its reason. A project already in the list (same name and same design) is skipped. File, Open on a projects file says to import it in Projects.

**Empty list:** "No projects yet. Save to projects keeps the design on show here; Import .json adds saved files."

## 4. The design on show and its project

- The header's design strip shows, after the name, **In projects** or **Unsaved** (a quiet chip that opens the list). On a phone the same chip is in the design sheet, and More, Data, Projects says "Open: X" or "This design is not in projects".
- **Write-back:** after each change to the design on show, 0.5 s later, its file is written to the open project when its text changed; `modified` and the thumbnail are updated. A pending write is flushed when the list opens a project and when the page is hidden.
- **Overtaken:** a write checks that the stored record's `modified` is still the one this tab knows. When another tab wrote it since, nothing is written: the design on show turns unsaved, and the status line says "Project "X" was changed in another tab or version; your design here is now unsaved. Save to projects keeps it as a new project."
- **Unreadable:** a linked project whose design this version cannot read (a later version wrote it) is treated the same way: never written over.
- **At start:** the autosave opens as today, linked to the project of the marker. When the list is read: no such project, the design is unsaved; the same content, nothing to do; the project unchanged since this tab knew it, the autosave (newer) is written to it; changed since, the design turns unsaved with the message above.
- **New, Open, examples, lessons, workflows, a link:** an unsaved design. **Save to projects** (File, the list, the chip) makes it a project and links the design on show and the steps of Undo since it was opened or started.
- **Undo across opening a project:** each design in the history remembers its project. Undo after opening B shows A again, linked to A (or unsaved); Redo shows B, linked to B. Writes follow the design on show, so B keeps the state it had when you stepped back.

## 5. Migration

Once, when the list is first read in a browser that stores projects, it is empty and `smithonline.projects.migrated` is not set: the autosave read at the start (when it reads) becomes the first project, with its name. When that design is the one on show, it is the open project. When a link opened over it, the project is made and the link's design stays unsaved. The flag is set once the write succeeds; without storage nothing is migrated and nothing is set. A non-empty list is never migrated into.

## 6. Limits

- **500 projects.** Save to projects, Duplicate and Import refuse past it: "The list holds 500 projects at most: export and delete some to make room." Writing back to the open project is never refused for the count.
- **20 MB per project** (characters of the design file; a design with several large part files). Save and import refuse a larger one; a write-back that would pass it is not made, the project keeps its last version and the status line says so once ("too large for the project list; File, Save as Smith Online keeps it as a file"). The autosave still holds the design.
- **Import:** files up to 100 MB.

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
- `store/useProjects.ts`: the list, write-back, migration, import, the open marker.
- `store/useDesignStore.ts`: `projectId`, the project of each design in the history, `loadDesign(design, label, project)`, `adoptProject`.
- `components/ProjectsDialog.tsx`, `components/ProjectChip.tsx`; File, Projects… and Save to projects; More, Data, Projects; Settings line.

## 10. QA checklist

1. Save to projects, edit, reload: the project opens, linked, with the edit.
2. Open another project; Undo: the first design and its project; Redo: the second.
3. Rename in the list and in the header: both names follow; Undo of a header rename renames the project back.
4. Duplicate, Delete with Undo (dialog and toast), deleting the open project leaves an unsaved design.
5. Export one opens with File, Open; Export all then Import into an empty browser gives the same list; importing it again skips every project.
6. A hostile record (no id, a number for `file`, a script in the name, a path with other letters in `thumb`): skipped or cleaned, never rendered as markup.
7. An unreadable record: listed, Export works, Open says why, nothing rewrites it.
8. Quota: a refused write keeps the design on show and the autosave, and says so; private window: the memory note.
9. Two tabs on one project: the second write turns the design unsaved with the message.
10. Migration once: the autosave becomes the first project; a second start adds nothing.
11. Desktop 1440 x 900 and phone: the list, its actions, the chip and More, Data, Projects; keyboard and Escape.
