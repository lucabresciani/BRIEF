# Third-party notices

BRIEF is released under the [MIT License](LICENSE). It is built from, and its production build
redistributes, the third-party components listed below. Each component remains under its own
licence; the licence texts are reproduced at the end of this file.

Every production build also writes `THIRD_PARTY_LICENSES.md` to `dist/`, generated at build time
with the full licence text of each npm package whose code or files the build ships. This file lists
the same components and adds what that generated report does not show: the libraries compiled into
the prebuilt Plotly.js bundle, the code generated at build time (the Tailwind CSS stylesheet with
tw-animate-css and the shadcn/ui variants, and the service worker registration helper of
vite-plugin-pwa) and the third-party material stored in this repository.

## Files stored in this repository

| Path                     | Component                                                                                                   | Licence            | Copyright                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------- |
| `vendor/xlsx-0.20.3.tgz` | SheetJS Community Edition 0.20.3 ([details](vendor/README.md))                                              | Apache-2.0         | Copyright (C) 2012-present SheetJS LLC        |
| `tests/fixtures/nist/`   | NIST Statistical Reference Datasets ([details](tests/fixtures/nist/README.md))                              | US Government work | Not subject to copyright in the United States |
| `src/components/ui/`     | Components generated with the shadcn/ui CLI and the shadcn/ui Tailwind variants (`shadcn.css`), then edited | MIT                | Copyright (c) 2023 shadcn                     |

## Components in the application

| Component                                                                                                                                                                             | Version                | Licence    | Copyright                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [React](https://github.com/facebook/react) (`react`, `react-dom`, `scheduler`, `use-sync-external-store`)                                                                             | 19.3.0                 | MIT        | Copyright (c) Meta Platforms, Inc. and affiliates.                                                                           |
| [Base UI](https://github.com/mui/base-ui) (`@base-ui/react`, `@base-ui/utils`)                                                                                                        | 1.8.0 / 0.4.0          | MIT        | Copyright (c) 2019 Material-UI SAS                                                                                           |
| [Floating UI](https://github.com/floating-ui/floating-ui) (`@floating-ui/core`, `dom`, `react-dom`, `utils`)                                                                          | 1.8.0 / 2.1.9 / 0.2.12 | MIT        | Copyright (c) 2021-present Floating UI contributors                                                                          |
| [Plotly.js](https://github.com/plotly/plotly.js) cartesian bundle (`plotly.js-cartesian-dist-min`) and its Italian locale (`plotly.js`)                                               | 4.1.2                  | MIT        | Copyright (c) 2016-2024 Plotly Technologies Inc. (the bundle header reads "Copyright 2012-2026, Plotly, Inc.")               |
| [react-plotly.js](https://github.com/plotly/react-plotly.js)                                                                                                                          | 4.1.0                  | MIT        | Copyright (c) 2017-2024 Plotly Technologies Inc.                                                                             |
| [SheetJS Community Edition](https://sheetjs.com) (`xlsx`, including its code page tables)                                                                                             | 0.20.3                 | Apache-2.0 | Copyright (C) 2012-present SheetJS LLC                                                                                       |
| [Papa Parse](https://github.com/mholt/PapaParse)                                                                                                                                      | 5.7.0                  | MIT        | Copyright (c) 2015 Matthew Holt                                                                                              |
| [Zod](https://github.com/colinhacks/zod)                                                                                                                                              | 4.6.5                  | MIT        | Copyright (c) 2025 Colin McDonnell                                                                                           |
| [Zustand](https://github.com/pmndrs/zustand)                                                                                                                                          | 5.0.15                 | MIT        | Copyright (c) 2019 Paul Henschel                                                                                             |
| [Immer](https://github.com/immerjs/immer)                                                                                                                                             | 11.1.21                | MIT        | Copyright (c) 2017 Michel Weststrate                                                                                         |
| [TanStack Virtual](https://github.com/TanStack/virtual) (`@tanstack/react-virtual`, `@tanstack/virtual-core`)                                                                         | 3.14.13 / 3.17.11      | MIT        | Copyright (c) 2021-present Tanner Linsley                                                                                    |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)                                                                                                           | 4.14.2                 | MIT        | Copyright (c) 2018 Brian Vaughn                                                                                              |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval)                                                                                                                             | 6.3.0                  | Apache-2.0 | Copyright 2016, Jake Archibald                                                                                               |
| [class-variance-authority](https://github.com/joe-bell/cva)                                                                                                                           | 0.7.1                  | Apache-2.0 | Copyright 2022 Joe Bell                                                                                                      |
| [clsx](https://github.com/lukeed/clsx)                                                                                                                                                | 2.1.1                  | MIT        | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)                                                           |
| [cn](https://www.npmjs.com/package/cn)                                                                                                                                                | 0.4.0                  | MIT        | Copyright (c) 2026 shadcn                                                                                                    |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`)                                                                                                                     | 1.52.0                 | ISC        | Copyright (c) 2026 Lucide Icons and Contributors; the icons derived from Feather: MIT, Copyright (c) 2013-present Cole Bemis |
| [Workbox](https://github.com/GoogleChrome/workbox) (`workbox-window` in the app; `workbox-core`, `workbox-precaching`, `workbox-routing`, `workbox-strategies` in the service worker) | 7.4                    | MIT        | Copyright 2018 Google LLC                                                                                                    |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) (service worker registration helper)                                                                                   | 2.0.0                  | MIT        | Copyright (c) 2020-PRESENT Anthony Fu                                                                                        |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (the generated stylesheet, including Preflight)                                                                           | 4.3.3                  | MIT        | Copyright (c) Tailwind Labs, Inc.                                                                                            |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)                                                                                                                       | 1.4.0                  | MIT        | Copyright (c) 2025 Wombosvideo                                                                                               |
| [shadcn/ui](https://github.com/shadcn-ui/ui) (component sources and their Tailwind stylesheet)                                                                                        | 4.21.3                 | MIT        | Copyright (c) 2023 shadcn                                                                                                    |
| [IBM Plex Sans](https://github.com/IBM/plex) (variable) via [Fontsource](https://fontsource.org) (`@fontsource-variable/ibm-plex-sans`)                                               | 5.3.0                  | OFL-1.1    | Copyright 2019 IBM Corp. All rights reserved.                                                                                |
| [IBM Plex Mono](https://github.com/IBM/plex) via [Fontsource](https://fontsource.org) (`@fontsource/ibm-plex-mono`)                                                                   | 5.3.0                  | OFL-1.1    | Copyright 2017 IBM Corp. All rights reserved.                                                                                |

The IBM Plex fonts are redistributed unmodified, as the `.woff2` and `.woff` files published by
Fontsource. The upstream project reserves the font name "Plex".

## Libraries compiled into the Plotly.js bundle

`plotly.js-cartesian-dist-min` is a prebuilt, minified bundle. Besides Plotly's own code it contains
the libraries below, identified from the licence comments at the end of the bundle and from the
module graph of the cartesian build of plotly.js 4.1.2. The authoritative list is the
[dependency tree of plotly.js](https://www.npmjs.com/package/plotly.js/v/4.1.2?activeTab=dependencies).

| Library                                                                           | Licence      | Copyright                                                                   |
| --------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `@plotly/d3` (Plotly's fork of D3 version 3)                                      | BSD-3-Clause | Copyright (c) 2010-2016, Michael Bostock                                    |
| `d3-format`                                                                       | BSD-3-Clause | Copyright 2010-2015 Mike Bostock                                            |
| `d3-time`                                                                         | BSD-3-Clause | Copyright 2010-2016 Mike Bostock                                            |
| `d3-time-format`                                                                  | BSD-3-Clause | Copyright 2010-2017 Mike Bostock                                            |
| MapLibre GL JS stylesheet (`maplibre-gl.css`, injected by every Plotly.js bundle) | BSD-3-Clause | Copyright (c) 2023, MapLibre contributors; Copyright (c) 2020, Mapbox       |
| `ieee754`                                                                         | BSD-3-Clause | Feross Aboukhadijeh (as stated in the bundle)                               |
| `buffer`, `safe-buffer`                                                           | MIT          | Feross Aboukhadijeh                                                         |
| `assert` (browser port of the Node.js module)                                     | MIT          | Its buffer comparison helper: Feross Aboukhadijeh (as stated in the bundle) |
| `object-assign`                                                                   | MIT          | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)     |
| `native-promise-only`                                                             | MIT          | (c) Kyle Simpson                                                            |
| `polybooljs`                                                                      | MIT          | Copyright (c) 2016 Sean Connelly (@voidqk, web: syntheti.cc)                |
| `world-calendars`                                                                 | MIT          | Copyright (c) 2016 alexcjohnson                                             |
| `culori`                                                                          | MIT          | Copyright (c) 2018 Dan Burzo                                                |
| `fast-isnumeric`                                                                  | MIT          | Copyright (c) 2015 Alex Johnson                                             |
| `is-string-blank`                                                                 | MIT          | Copyright (c) 2015 Alex Johnson                                             |
| `base64-arraybuffer`                                                              | MIT          | Copyright (c) 2012 Niklas von Hertzen                                       |
| `probe-image-size`                                                                | MIT          | Copyright (c) 2015 Vitaly Puzrin.                                           |
| `stream-parser`                                                                   | MIT          | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net>                  |
| `debug`                                                                           | MIT          | Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca>                      |
| `ms`                                                                              | MIT          | Copyright (c) 2016 Zeit, Inc.                                               |
| `events`                                                                          | MIT          | Copyright Joyent, Inc. and other Node contributors.                         |
| `has-hover`                                                                       | MIT          | Dima Yv                                                                     |
| `has-passive-events`                                                              | MIT          | Copyright (c) 2017 Dmitry Ivanov                                            |
| `is-browser`                                                                      | MIT          | Copyright (c) 2013 Forbes Lindesay                                          |
| `is-mobile`                                                                       | MIT          | Julian Gruber                                                               |
| `mouse-event-offset`                                                              | MIT          | Copyright (c) 2014 Matt DesLauriers                                         |
| `parse-svg-path`                                                                  | MIT          | Copyright (c) 2013 Jake Rosoman <jkroso@gmail.com>                          |
| `point-in-polygon`                                                                | MIT          | Copyright (c) 2016 James Halliday                                           |
| `gl-mat4`                                                                         | Zlib         | Copyright (c) 2013 Brandon Jones, Colin MacKenzie IV                        |

## Licence texts

### MIT License

Every component listed above as MIT is distributed under this text, with the copyright line given
for it in the tables.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC License (Lucide)

```text
Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### BSD 3-Clause License (`@plotly/d3`)

```text
Copyright (c) 2010-2016, Michael Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* The name Michael Bostock may not be used to endorse or promote products
  derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL MICHAEL BOSTOCK BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause License (`d3-format`, `d3-time`, `d3-time-format`)

`d3-time` and `d3-time-format` use the same text as `d3-format`, with the copyright lines listed in
the table above.

```text
Copyright 2010-2015 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause License (MapLibre GL JS stylesheet)

```text
Copyright (c) 2023, MapLibre contributors

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of MapLibre GL JS nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


-------------------------------------------------------------------------------

Contains code from mapbox-gl-js v1.13 and earlier

Version v1.13 of mapbox-gl-js and earlier are licensed under a BSD-3-Clause license

Copyright (c) 2020, Mapbox
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
* Neither the name of Mapbox GL JS nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause License (`ieee754`)

The bundle carries the notice "ieee754. BSD-3-Clause License. Feross Aboukhadijeh"; the full text is
in the [ieee754 repository](https://github.com/feross/ieee754/blob/master/LICENSE).

### zlib License (`gl-mat4`)

```text
Copyright (c) 2013 Brandon Jones, Colin MacKenzie IV

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

 1. The origin of this software must not be misrepresented you must not
    claim that you wrote the original software. If you use this software
    in a product, an acknowledgment in the product documentation would be
    appreciated but is not required.

 2. Altered source versions must be plainly marked as such, and must not
    be misrepresented as being the original software.

 3. This notice may not be removed or altered from any source distribution.
```

### Apache License 2.0 (SheetJS, idb-keyval, class-variance-authority)

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### SIL Open Font License 1.1 (IBM Plex Sans, IBM Plex Mono)

```text
Copyright 2019 IBM Corp. All rights reserved. (IBM Plex Sans)
Copyright 2017 IBM Corp. All rights reserved. (IBM Plex Mono)

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
