# MNores Android — Codespaces + Expo Go

This branch is the development branch. The `main` branch remains the stable baseline.

## 1. Open the repository in GitHub Codespaces

Create/open a Codespace from:

- repository: `scantid-rb/mnores-android`
- branch: `android-review-base`

The `.devcontainer/devcontainer.json` file installs Node 22 and the required VS Code extensions and runs `yarn install` inside `frontend`.

## 2. Configure the API URL

Create `frontend/.env` from `frontend/.env.example`:

```bash
cp frontend/.env.example frontend/.env
```

Then set:

```text
EXPO_PUBLIC_API_BASE_URL=https://YOUR-MNORES-API-HOST
```

Do not commit credentials or private secrets.

## 3. Start Expo

From the repository root:

```bash
cd frontend
yarn start --tunnel
```

Equivalent:

```bash
npx expo start --tunnel
```

The tunnel is useful because the Expo Go app on the physical Android phone does not need direct network access to the Codespace.

## 4. Test with Expo Go

Install/open Expo Go on the Android phone and scan the QR code shown by Expo.

Keep the Codespace terminal running while testing.

## 5. Useful checks

```bash
cd frontend
npx expo-doctor
yarn lint
```

These checks should be run before committing substantial changes.

## Development rules

- Work on `android-review-base`.
- Do not commit `frontend/.env`.
- Do not modify `main` directly.
- Keep commits small and descriptive.
- Test offline behavior explicitly before changing synchronization code.
