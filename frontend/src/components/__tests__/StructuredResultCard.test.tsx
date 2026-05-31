import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import StructuredResultCard from '../chat/StructuredResultCard';
import type { StructuredResult } from '../../types';

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

describe('StructuredResultCard - compliance_result', () => {
  it('renders framework name and gap controls', () => {
    const result: StructuredResult = {
      kind: 'compliance_result',
      data: {
        framework: 'NIST-800-53',
        controls_met: ['AC-2', 'AC-3'],
        gaps: [
          {
            control: 'AU-2',
            gap: 'audit logging not centralized',
            remediation: 'enable Azure Monitor diagnostic settings',
            azure_service: 'Azure Monitor',
          },
        ],
        azure_policy_recommendations: ['deny public storage'],
      },
    };
    render(wrap(<StructuredResultCard result={result} />));
    expect(screen.getByText('NIST-800-53')).toBeInTheDocument();
    expect(screen.getByText('AU-2')).toBeInTheDocument();
    expect(screen.getByText(/audit logging not centralized/)).toBeInTheDocument();
  });
});
