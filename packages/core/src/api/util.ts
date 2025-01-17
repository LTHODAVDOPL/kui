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

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-namespace */

/**
 * API: utility
 *
 */

import * as FindFile from '../core/find-file'
import * as Utility from '../core/utility'
import * as Home from '../util/home'

export namespace Util {
  export import expandHomeDir = Home.expandHomeDir

  export import findFile = FindFile.findFile
  export import findFileWithViewer = FindFile.findFileWithViewer
  export import isSpecialDirectory = FindFile.isSpecialDirectory
  export import augmentModuleLoadPath = FindFile.addPath

  export import flatten = Utility.flatten
}

export default Util
