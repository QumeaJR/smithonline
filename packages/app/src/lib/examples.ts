/**
 * The example projects shipped with Smith V4.1, bundled from the core test
 * fixtures. They are Fritz Dellsperger's work and are offered here as
 * one-click demos with attribution; the descriptions are ours.
 */
const files = import.meta.glob('../../../core/test/fixtures/xmlsc/*.xmlsc', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface ExampleEntry {
  readonly file: string;
  readonly title: string;
  readonly description: string;
  readonly xml: string;
}

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Example1.xmlsc': 'L-network with shunt L and series C at 150 MHz',
  'Example2.xmlsc': 'L-network, second solution',
  'Example3.xmlsc': 'L-network with series L and shunt C',
  'Example4.xmlsc': 'L-network, mirrored topology',
  'Example5.xmlsc': 'Five-element match of 20 - j12 at 450 MHz with a Q contour',
  'Example6.xmlsc': 'Six-element low-Q match',
  'Example7.xmlsc': 'Three-element Pi match',
  'Example8.xmlsc': 'Series line and shunt C at 430 MHz',
  'Example9.xmlsc': 'Series line and open stub',
  'Example10.xmlsc': 'Series line and shorted stub',
  'Example11.xmlsc': 'Line with two shorted stubs',
  'Example12.xmlsc': 'Two lines and an open stub',
  'Example13-input.xmlsc': 'Amplifier input: series L with stability, gain and noise circles',
  'Example13-output1.xmlsc': 'Amplifier output match, lumped',
  'Example13-output2.xmlsc': 'Amplifier output match, line and shunt C',
  'Example13-output3.xmlsc': 'Amplifier output match, shorted stub and series C',
  'Example14-1.xmlsc': 'Two-element match, variant 1',
  'Example14-2.xmlsc': 'Two-element match, variant 2',
  'Example15.xmlsc': 'Lossy 2 dB/m line (er 2.1) and series L at 500 MHz',
  'Example16.xmlsc': 'Three-element network with a 10 to 450 MHz frequency sweep',
  'Example17.xmlsc': 'Four-element network with a datapoint sweep over three loads',
  'Example18.xmlsc': 'Five-element network with a VSWR circle',
};

export const EXAMPLES: readonly ExampleEntry[] = Object.entries(files)
  .map(([path, xml]) => {
    const file = path.slice(path.lastIndexOf('/') + 1);
    return {
      file,
      title: file.replace('.xmlsc', '').replace('Example', 'Example ').replace('-', ' '),
      description: DESCRIPTIONS[file] ?? '',
      xml,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
