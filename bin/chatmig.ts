#!/usr/bin/env ts-node

import { greet } from '../src/services/greeting';

const person = 'World';
console.log(greet(person));
