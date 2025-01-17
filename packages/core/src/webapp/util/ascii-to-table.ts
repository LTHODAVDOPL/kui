/*
 * Copyright 2018 IBM Corporation
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

import stripClean from 'strip-ansi'

import { Cell, Row, Table, TableStyle } from '../models/table'

import formatAsPty from './pretty-print'

import i18n from '../../util/i18n'
const strings = i18n('core')

// eslint-disable-next-line no-control-regex
const isAnsi = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/

function indexOf(haystack: string, needle: string, startIdx: number): { startIdx: number; endIdx: number } {
  const idx = haystack.indexOf(needle, startIdx)
  if (idx !== -1) {
    return { startIdx, endIdx: idx + needle.length }
  }

  let hidx = startIdx
  let nidx = 0
  while (hidx < haystack.length && nidx < needle.length) {
    const h = haystack.charAt(hidx)
    const n = needle.charAt(nidx)
    if (h === '\x1b') {
      do {
        hidx++
      } while (hidx < haystack.length && !(haystack.charAt(hidx) === 'm'))
      hidx++
    } else if (nidx > 0 && isAnsi.test(h)) {
      hidx++
    } else if (h !== n) {
      hidx++
      nidx = 0
    } else {
      hidx++
      nidx++
    }
  }

  if (nidx === needle.length) {
    return { startIdx, endIdx: hidx }
  } else {
    return { startIdx, endIdx: startIdx + needle.length }
  }
}

/**
 * Format as a link, if the given string looks like a URL
 *
 */
function maybeURL(str: string): HTMLAnchorElement {
  try {
    const url = new URL(str)
    if (url.host) {
      const link = document.createElement('a')
      link.target = '_blank'
      link.innerText = strings('link')
      link.title = str
      link.href = str
      return link
    }
  } catch (err) {
    // ok, it's not a URL
  }
}

/**
 * Split the given string at the given split indices
 *
 */
interface Pair {
  key: string
  value: string
  valueDom: Element
  css: string
}
const split = async (str: string, splits: number[], headerCells?: string[]): Promise<Pair[]> => {
  const stripped = stripClean(str)

  let lastEnd = 0
  return Promise.all(
    splits.map(async (splitIndex, idx) => {
      const plain = stripped.substring(splitIndex, splits[idx + 1] || stripped.length).trim()
      const { startIdx, endIdx } = indexOf(str, plain, lastEnd)
      const value = str.slice(startIdx, endIdx).trim()
      const valueDom = maybeURL(plain) || (await formatAsPty([value], false))

      lastEnd = endIdx

      return {
        key: headerCells && headerCells[idx],
        value: plain,
        valueDom,
        css: ''
      }
    })
  )
}

/**
 * Find the column splits
 *
 */
export const preprocessTable = async (raw: string[]): Promise<{ rows?: Pair[][]; trailingString?: string }[]> => {
  return Promise.all(
    raw.map(async table => {
      const firstNewlineIdx = table.indexOf('\n')
      let header = stripClean(table.substring(0, firstNewlineIdx).replace(/\t/g, ' '))

      if (header.trim().length === 0) {
        // the first line might be blank (except for control characters)
        table = table.slice(firstNewlineIdx + 1)
        const secondNewlineIdx = table.indexOf('\n')
        header = stripClean(table.substring(0, secondNewlineIdx).replace(/\t/g, ' '))
      }

      const headerCells = await header
        .split(/(\t|\s\s)+\s?/)
        .filter(x => x && !x.match(/(\t|\s\s)/))
        .map(_ => _.trim())

      // now we scan the header row to determine the column start indices
      const columnStarts: number[] = []

      for (let idx = 0, jdx = 0; idx < headerCells.length; idx++) {
        const { offset, prefix } = idx === 0 ? { offset: 0, prefix: '' } : { offset: 1, prefix: ' ' }

        const newJdx = header.indexOf(prefix + headerCells[idx] + ' ', jdx)
        if (newJdx < 0) {
          // last column
          jdx = header.indexOf(' ' + headerCells[idx], jdx)
        } else {
          jdx = newJdx
        }
        columnStarts.push(jdx + offset)

        jdx = newJdx + headerCells[idx].length
      }

      // do we have just tiny columns? if so, it's not worth tabularizing
      const tinyColumns = columnStarts.reduce((yup, start, idx) => {
        return yup && (idx > 0 && start - columnStarts[idx - 1] <= 2)
      }, true)

      if (columnStarts.length <= 1 || tinyColumns) {
        // probably not a table
        return {
          trailingString: table
        }
      } else {
        const possibleRows = table.split(/\n/)

        // look to see if any of the possibleRows violate the
        // columnStarts alignment; this is a good indication that the
        // possibleRows are not really rows of a table
        const endOfTable = possibleRows.map(stripClean).findIndex(row => {
          const nope = columnStarts.findIndex(idx => {
            return idx > 0 && !/\s/.test(row[idx - 1])
          })

          return nope !== -1
        })

        const rows = endOfTable === -1 ? possibleRows : possibleRows.slice(0, endOfTable)

        const preprocessed = (await Promise.all(
          rows.map(line => {
            return split(line, columnStarts, headerCells)
          })
        )).filter(x => x)

        const trailingString = endOfTable !== -1 && possibleRows.slice(endOfTable).join('\n')

        return {
          trailingString,
          rows: preprocessed
        }
      }
    })
  )
}

/** normalize the status badge by capitalization */
const capitalize = (str: string): string => {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1).toLowerCase()
}

/** decorate certain columns specially */
export const outerCSSForKey: { [key: string]: string } = {
  NAME: 'entity-name-group',
  READY: 'a-few-numbers-wide',
  KIND: 'max-width-id-like entity-kind',

  NAMESPACE: 'entity-name-group entity-name-group-narrow',

  DISPLAY: 'hide-with-sidecar',
  TYPE: 'hide-with-sidecar',
  ENDPOINT: 'hide-with-sidecar',

  CLUSTER: 'entity-name-group entity-name-group-narrow hide-with-sidecar', // kubectl config get-contexts
  AUTHINFO: 'entity-name-group entity-name-group-narrow hide-with-sidecar', // kubectl config get-contexts
  REFERENCE: 'entity-name-group entity-name-group-narrow hide-with-sidecar', // istio autoscaler

  CREATED: 'hide-with-sidecar',
  'CREATED AT': 'hide-with-sidecar',

  ID: 'max-width-id-like',

  // kubectl get deployment
  CURRENT: 'entity-name-group entity-name-group-extra-narrow text-center',
  DESIRED: 'entity-name-group entity-name-group-extra-narrow text-center',

  RESTARTS: 'very-narrow',

  'LAST SEEN': 'hide-with-sidecar entity-name-group-extra-narrow', // kubectl get events
  'FIRST SEEN': 'hide-with-sidecar entity-name-group-extra-narrow', // kubectl get events

  UPDATED: 'min-width-date-like', // helm ls
  REVISION: 'hide-with-sidecar', // helm ls
  AGE: 'hide-with-sidecar very-narrow', // e.g. helm status and kubectl get svc
  'PORT(S)': 'entity-name-group entity-name-group-narrow hide-with-sidecar', // helm status for services
  SUBOBJECT: 'entity-name-group entity-name-group-extra-narrow' // helm ls
}

/**
 * Return an array with at least maxColumns entries
 *
 */
const fillTo = (length: number, maxColumns: number) => {
  if (length >= maxColumns) {
    return []
  } else {
    return new Array(maxColumns - length).fill('')
  }
}

export const cssForKey: { [key: string]: string } = {
  // kubectl get events
  NAME: 'entity-name',
  SOURCE: 'lighter-text smaller-text',
  SUBOBJECT: 'lighter-text smaller-text',
  'CREATED AT': 'lighter-text smaller-text',

  AGE: 'slightly-deemphasize',

  'APP VERSION': 'pre-wrap slightly-deemphasize', // helm ls
  UPDATED: 'slightly-deemphasize somewhat-smaller-text'
}

const tagForKey: { [key: string]: string } = {
  PHASE: 'badge',
  STATE: 'badge',
  STATUS: 'badge'
}

/** decorate certain values specially */
export const cssForValue: { [key: string]: string } = {
  // generic
  NORMAL: 'green-background',
  Normal: 'green-background',
  normal: 'green-background',

  // helm lifecycle
  UNKNOWN: '',
  DEPLOYED: 'green-background',
  DELETED: '',
  SUPERSEDED: 'yellow-background',
  FAILED: 'red-background',
  DELETING: 'yellow-background',

  // pod lifecycle
  'Init:0/1': 'yellow-background',
  PodScheduled: 'yellow-background',
  PodInitializing: 'yellow-background',
  Initialized: 'yellow-background',
  Terminating: 'yellow-background',

  // kube lifecycle
  CrashLoopBackOff: 'red-background',
  Error: 'red-background',
  Failed: 'red-background',
  Running: 'green-background',
  Pending: 'yellow-background',
  Completed: 'gray-background', // successfully terminated; don't use a color
  Unknown: '',

  // AWS events
  Ready: 'green-background',
  ProvisionedSuccessfully: 'green-background',

  // kube events
  Active: 'green-background',
  Online: 'green-background',
  NodeReady: 'green-background',
  Pulled: 'green-background',
  Rebooted: 'green-background',
  Started: 'green-background',
  Created: 'green-background',
  Succeeded: 'green-background',
  SuccessfulCreate: 'green-background',
  SuccessfulMountVol: 'green-background',
  ContainerCreating: 'yellow-background',
  Starting: 'yellow-background',
  NodeNotReady: 'yellow-background',
  Killing: 'yellow-background',
  Deleting: 'yellow-background',
  Pulling: 'yellow-background',
  BackOff: 'yellow-background',
  FailedScheduling: 'red-background',
  FailedKillPod: 'red-background'
}

/**
 * Turn an IPair[][], i.e. a table of key-value pairs into a Table,
 * i.e. kui Table model. IPair is defined below, it is internal just
 * to this file.
 *
 * TODO factor out kube-specifics to plugin-k8s
 *
 */
export const formatTable = (entityType: string, lines: Pair[][]): Table => {
  // maximum column count across all rows
  const nameColumnIdx = Math.max(0, lines[0].findIndex(({ key }) => key === 'NAME'))
  const maxColumns = lines.reduce((max, columns) => Math.max(max, columns.length), 0)

  // e.g. Name: -> NAME
  const keyForFirstColumn = lines[0][nameColumnIdx].key.replace(/:/g, '').toUpperCase()

  const allRows: Row[] = lines.map((columns: Pair[], idx: number) => {
    const nameForDisplay = columns[0].value
    const firstColumnCSS = idx === 0 || columns[0].key !== 'CURRENT' ? '' : 'selected-entity'

    const rowIsSelected = columns[0].key === 'CURRENT' && nameForDisplay === '*'
    // const rowKey = columns[0].key
    // const rowValue = columns[0].value
    const rowCSS = [rowIsSelected ? 'selected-row' : '']

    const attributes: Cell[] = columns
      .slice(1)
      .map(({ key, value: column, valueDom, css }) => ({
        key,
        value: idx > 0 && /STATUS|STATE/i.test(key) ? capitalize(column) : column,
        valueDom,
        css
      }))
      .map(({ key, value: column, valueDom, css }, colIdx) => ({
        key,
        tag: (idx > 0 && tagForKey[key]) || undefined,
        onclick: false,
        outerCSS:
          (outerCSSForKey[key] || '') +
          (colIdx <= 1 || colIdx === nameColumnIdx - 1 || /STATUS/i.test(key) ? '' : ' hide-with-sidecar'), // nameColumnIndex - 1 beacuse of rows.slice(1)
        css:
          css +
          (column.length > 20 ? ' pretty-wide' : '') +
          ' ' +
          ((idx > 0 && cssForKey[key]) || '') +
          ' ' +
          (cssForValue[column] || ''),
        valueDom,
        value: column
      }))
      .concat(fillTo(columns.length, maxColumns))

    const row: Row = {
      key: keyForFirstColumn,
      name: nameForDisplay,
      nameDom: columns[0].valueDom,
      fontawesome: idx !== 0 && columns[0].key === 'CURRENT' && 'fas fa-network-wired',
      onclick: false,
      css: firstColumnCSS,
      rowCSS,
      // title: tables.length > 1 && idx === 0 && lines.length > 1 && kindFromResourceName(lines[1][0].value),
      outerCSS: outerCSSForKey[columns[0].key] || '',
      attributes
    }

    return row
  })

  const hasHeader = !/[:/]/.test(allRows[0].name)
  const header = hasHeader ? allRows[0] : undefined
  const body = hasHeader ? allRows.slice(1) : allRows

  // if we don't have a header, use zebra striping; otherwise use
  // Light, which is closest to a pure terminal style
  const style: TableStyle = !header ? TableStyle.Light : TableStyle.Medium

  const model: Table = {
    title: entityType,
    header,
    body,
    style,
    noSort: true
  }

  return model
}
