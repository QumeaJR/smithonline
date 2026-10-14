# Smith Online

A browser-based Smith chart and S-parameter tool, rebuilt from scratch and inspired by **Smith V4.1** by Prof. Fritz Dellsperger (http://www.fritz.dellsperger.net/smith.html). The goal is the same workflow RF students and engineers know from the original, with a modern interface, no installation, and compatibility with existing `.xmlsc` project files.

Status: planning. See `PLAN.md` for the roadmap and `docs/` for the analysis, the architecture decision and the UI concept. A static mockup of the interface is in `docs/mockup/index.html`.

## Repository layout

```
original/   reference material from the author's site (installer, examples, documents); not part of the build
docs/       analysis of the original, ADRs, UI design, mockup
PLAN.md     phased implementation plan
```

## Credits

The original Smith program, its examples and documentation are the work of Fritz Dellsperger. This project does not contain or derive from his source code; it reimplements the published functionality using standard RF engineering references (for example HP Application Note 95-1). Touchstone is a trademark of its respective owner.
