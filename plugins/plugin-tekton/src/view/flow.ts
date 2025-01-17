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

import { basename, dirname } from 'path'

import UI from '@kui-shell/core/api/ui'
import { KubeResource } from '@kui-shell/plugin-k8s'

import runMode from '../model/modes/run'
import flowMode from '../model/modes/flow'
import { PipelineRun } from '../model/resource'
import tekton2graph from '../lib/tekton2graph'

const debug = Debug('plugins/tekton/view/flow')

/**
 * Format a repl response
 *
 */
export default async (tab: UI.Tab, jsons: KubeResource[], run?: PipelineRun, raw?: string, filepath?: string) => {
  if (!raw) {
    const { safeDump } = await import('js-yaml')
    raw = safeDump(jsons)
  }

  const [graph] = await Promise.all([
    tekton2graph(jsons, filepath, run) // generate the graph model
  ])
  debug('graph', graph)

  const { graph2doms, injectCSS, zoomToFitButtons } = await import('@kui-shell/plugin-wskflow')

  injectCSS()

  const content = document.createElement('div')
  content.classList.add('padding-content')
  content.style.flex = '1'
  content.style.display = 'flex'

  const { controller } = await graph2doms(tab, graph, content, graph.runs, {
    layoutOptions: {
      'elk.separateConnectedComponents': false,
      'elk.spacing.nodeNode': 10,
      'elk.padding': '[top=7.5,left=5,bottom=7.5,right=5]',
      hierarchyHandling: 'INCLUDE_CHILDREN' // since we have hierarhical edges, i.e. that cross-cut subgraphs
    }
  })
  debug('content', content)

  const tektonModes: UI.Mode[] = [
    flowMode,
    runMode,
    {
      mode: 'Raw',
      leaveBottomStripeAlone: true,
      direct: {
        type: 'custom',
        isEntity: true,
        contentType: 'yaml',
        content: raw
      }
    }
  ]

  const badges: UI.Badge[] = ['Tekton']
  if (!run) {
    if (jsons.find(_ => _.kind === 'PipelineRun' || _.kind === 'TaskRun')) {
      badges.push({
        title: 'Runnable',
        css: 'green-background'
      })
    } else {
      badges.push({
        title: 'Not Runnable',
        css: 'yellow-background'
      })
    }
  }

  const startTime = run && run.status && run.status.startTime && new Date(run.status.startTime)
  const endTime = run && run.status && run.status.completionTime && new Date(run.status.completionTime)
  const duration = startTime && endTime && endTime.getTime() - startTime.getTime()

  return {
    type: 'custom',
    isEntity: true,
    isFromFlowCommand: true,
    name: filepath ? basename(filepath) : jsons[0].metadata.name,
    packageName: filepath && dirname(filepath),
    prettyType: run ? 'PipelineRun' : 'Pipeline',
    duration,
    badges,
    presentation: UI.Presentation.FixedSize,
    content,
    model: jsons,
    modes: tektonModes.concat(zoomToFitButtons(controller, { visibleWhenShowing: flowMode.mode }))
  }
}
