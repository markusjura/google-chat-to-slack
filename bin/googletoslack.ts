#!/usr/bin/env node

import { getParser } from '../src/cli/parser';

// biome-ignore lint/complexity/noVoid: cli executable
void getParser().argv;
