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

export interface Watchable {
  refreshCommand: string
  watchByDefault: boolean // false: the model can be turned into a watching mode, but not the default mode
  watchInterval?: number
  watchLimit?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isWatchable(model: any): model is Watchable {
  return model && model.refreshCommand
}
