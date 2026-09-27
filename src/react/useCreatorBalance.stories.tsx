import type { Meta, StoryObj } from '@storybook/react';
import { useCreatorBalance } from './useCreatorBalance';
import { DorisioProvider } from './DorisioProvider';

const meta: Meta<typeof UseCreatorBalanceStory> = {
  title: 'Hooks/useCreatorBalance',
  component: UseCreatorBalanceStory,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof UseCreatorBalanceStory>;

function UseCreatorBalanceStory() {
  const { balance, loading, error, lastUpdated, fetchBalance, refetch, reset } = useCreatorBalance();

  const handleFetchBalance = async () => {
    try {
      await fetchBalance('creator-123', 'wallet-456');
    } catch (err) {
      console.error('Failed to fetch balance:', err);
    }
  };

  const handleRefetch = async () => {
    try {
      await refetch();
    } catch (err) {
      console.error('Failed to refetch:', err);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>useCreatorBalance Hook</h2>
      <div style={{ marginBottom: '20px' }}>
        <strong>Loading:</strong> {loading ? 'Yes' : 'No'}
      </div>
      {error && (
        <div style={{ marginBottom: '20px', color: 'red' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {balance && (
        <div style={{ marginBottom: '20px' }}>
          <div>
            <strong>Total Earnings:</strong> ${balance.totalEarnings}
          </div>
          <div>
            <strong>Pending Balance:</strong> ${balance.pendingBalance}
          </div>
          {balance.lumens && (
            <div>
              <strong>Lumens:</strong> {balance.lumens}
            </div>
          )}
          {balance.usdc && (
            <div>
              <strong>USDC:</strong> {balance.usdc}
            </div>
          )}
        </div>
      )}
      {lastUpdated && (
        <div style={{ marginBottom: '20px' }}>
          <strong>Last Updated:</strong> {new Date(lastUpdated).toLocaleString()}
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleFetchBalance}
          disabled={loading}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Fetch Balance
        </button>
        <button
          onClick={handleRefetch}
          disabled={loading}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Refetch
        </button>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export const Default: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};

export const WithBalance: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};

export const LoadingState: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};

export const ErrorState: Story = {
  decorators: [
    (Story) => (
      <DorisioProvider
        config={{
          baseUrl: 'https://api.example.com',
          mode: 'sandbox',
        }}
      >
        <Story />
      </DorisioProvider>
    ),
  ],
};
