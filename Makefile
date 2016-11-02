#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (c) 2016, Joyent, Inc.
#

node_modules/.bin/eslint:
	@npm install

node_modules/.bin/tape:
	@npm install

check: node_modules/.bin/eslint
	@./node_modules/.bin/eslint ./

test: node_modules/.bin/tape
	@./node_modules/.bin/tape tests/test.*.js
