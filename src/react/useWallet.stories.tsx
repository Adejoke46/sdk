import type { Meta, StoryObj } from '@storybook/react';
import { useWallet } from './useWallet';
import { DorisioProvider } from './DorisioProvider';

const meta: Meta<typeof UseWalletStory> = {
  title: 'Hooks/useWallet',
  component: UseWalletStory,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof UseWalletStory>;

function UseWalletStory() {
  const {
    wallets,
    selectedWallet,
    loading,
    error,
    nonce,
    challengeStep,
    generateNonce,
    getChallenge,
    listWallets,
    reset,
  } = useWallet();

  const handleListWallets = async () => {
    try {
      await listWallets(true);
    } catch (err) {
      console.error('Failed to list wallets:', err);
    }
  };

  const handleGenerateNonce = async () => {
    try {
      const result = await generateNonce('test-public-key');
      console.log('Nonce generated:', result);
    } catch (err) {
      console.error('Failed to generate nonce:', err);
    }
  };

  const handleGetChallenge = async () => {
    try {
      const challenge = await getChallenge(nonce || '');
      console.log('Challenge:', challenge);
    } catch (err) {
      console.error('Failed to get challenge:', err);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>useWallet Hook</h2>
      <div style={{ marginBottom: '20px' }}>
        <strong>Challenge Step:</strong> {challengeStep}
      </div>
      <div style={{ marginBottom: '20px' }}>
        <strong>Loading:</strong> {loading ? 'Yes' : 'No'}
      </div>
      {error && (
        <div style={{ marginBottom: '20px', color: 'red' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {nonce && (
        <div style={{ marginBottom: '20px' }}>
          <strong>Nonce:</strong> {nonce}
        </div>
      )}
      <div style={{ marginBottom: '20px' }}>
        <strong>Wallets:</strong> {wallets.length}
      </div>
      {selectedWallet && (
        <div style={{ marginBottom: '20px' }}>
          <strong>Selected Wallet:</strong> {selectedWallet.id}
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={handleListWallets}
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
          List Wallets
        </button>
        <button
          onClick={handleGenerateNonce}
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
          Generate Nonce
        </button>
        <button
          onClick={handleGetChallenge}
          disabled={loading || !nonce}
          style={{
            padding: '10px 20px',
            backgroundColor: loading || !nonce ? '#ccc' : '#ffc107',
            color: 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || !nonce ? 'not-allowed' : 'pointer',
          }}
        >
          Get Challenge
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

export const WithWallets: Story = {
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

export const VerificationFlow: Story = {
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
