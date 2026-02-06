---
title: Templater Example
tags:
  - todo
  - daily-journal
date: <% tp.date.now("YYYY-MM-DD") %>
---

# Templater Note

This note has Templater syntax in the frontmatter. The YAML parser may fail on it.

The agent should skip this file gracefully (with a warning) rather than crash.

#productivity
