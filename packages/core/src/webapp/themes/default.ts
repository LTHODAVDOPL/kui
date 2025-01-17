/*
 * Copyright 2019 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Debug from 'debug'

import Settings from '@kui-shell/core/api/settings'

import findThemeByName from './find'

const debug = Debug('core/webapp/themes/default')

/**
 * @return the name of the default theme
 *
 */
export function getDefault(isDarkMode = false) {
  let defaultTheme = Settings.theme.defaultTheme

  if (isDarkMode) {
    const darkTheme = findThemeByName('Dark')
    if (darkTheme) {
      defaultTheme = darkTheme.name
    }
  }

  if (!defaultTheme) {
    console.error('theme bug: the theme does not set a default theme')
    defaultTheme = Settings.theme.themes[0] && Settings.theme.themes[0].name
    if (!defaultTheme) {
      throw new Error('SEVERE theme bug: no theme found')
    }
  }

  debug('using default theme %s', defaultTheme)
  return defaultTheme
}

export default getDefault
