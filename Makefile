#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (c) 2016, Joyent, Inc.
#

node_modules/eslint:
	@npm install

check: node_modules/eslint
	@./node_modules/.bin/eslint ./

