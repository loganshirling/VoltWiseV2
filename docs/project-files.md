# VoltWise Project Files

VoltWise project files let you save and reopen the inputs needed to reproduce a local analysis. Use **Save Project** in Data & Rates to download a versioned JSON file, and **Open Project** to select one from your device.

A project archive contains battery profiles and selected profile, saved tariff profiles and active rate schedule, financial assumptions, generation asset settings, site timezone and coordinates, load CSV input and its provenance, and imported solar or wind resource metadata and interval records. Opening a file rebuilds the parsed load dataset from the saved CSV and validates the project structure and resource records before changing the current workspace. A valid file prompts before replacing the current project; canceling or rejecting a file leaves the active workspace unchanged. Save the current project first if you may need to restore it.

Archives are processed in the browser and downloaded or read from the file you choose. VoltWise does not upload them. They may contain household electricity use and detailed site/resource data, so store and share the downloaded file accordingly. To delete a saved project, remove it from the download location or folder where you stored it; VoltWise keeps no separate project-file copy.

The current writer emits schema version 2. The first schema version stored the raw load CSV directly and did not record its source. Version 2 groups the CSV with provenance. When an older version 1 archive is opened, its CSV and settings are migrated, and the missing source remains unspecified rather than being guessed. Unsupported future versions, malformed JSON, incomplete project state, invalid timestamps, and corrupt solar/wind records are rejected.

Project archives are separate from analytical JSON and CSV exports. Analytical exports contain results and their assumptions; project archives contain editable inputs for reopening and re-simulation.
