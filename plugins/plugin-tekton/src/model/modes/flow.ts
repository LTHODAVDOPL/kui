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

import { Tab } from '@kui-shell/core/api/ui-lite'
import { Mode } from '@kui-shell/core/api/registrars'
import { KubeResource } from '@kui-shell/plugin-k8s'

import { getPipelineFromRef, getTasks } from '../fetch'
import { isPipelineRun, isPipeline } from '../resource'

export interface ResponseObject {
  isFromFlowCommand?: boolean
  model: KubeResource[]
  resource: KubeResource
}

/**
 * The sidecar mode for the tekton flow visualization
 *
 */
const flowMode: Mode = {
  mode: 'flow',
  direct: async (tab: Tab, _: ResponseObject) => {
    if (_.isFromFlowCommand) {
      // then _ is already the response we need
      return _
    } else {
      const resource = _.resource
      const flowView = (await import('../../view/flow')).default
      if (isPipelineRun(resource)) {
        const [pipeline, tasks] = await Promise.all([getPipelineFromRef(tab, resource), getTasks(tab)])
        return flowView(tab, [pipeline as KubeResource].concat(tasks), resource)
      } else if (isPipeline(resource)) {
        // fetch any accompanying Tasks
        const tasks = await getTasks(tab)
        return flowView(tab, [resource as KubeResource].concat(tasks))
      } else {
        return flowView(tab, [resource])
      }
    }
  },
  defaultMode: true,
  leaveBottomStripeAlone: true
}

export default flowMode
