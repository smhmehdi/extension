import React, {
  ReactElement,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react"
import { useTranslation } from "react-i18next"
import {
  clearSwapQuote,
  approveTransfer,
  selectLatestQuoteRequest,
  selectInProgressApprovalContract,
  fetchSwapQuote,
  fetchSwapPrice,
} from "@tallyho/tally-background/redux-slices/0x-swap"
import { FeatureFlags, isEnabled } from "@tallyho/tally-background/features"
import {
  getAssetsState,
  selectCurrentAccountBalances,
  selectCurrentAccountSigner,
  selectCurrentNetwork,
  selectMainCurrencySign,
} from "@tallyho/tally-background/redux-slices/selectors"
import {
  AnyAsset,
  FungibleAsset,
  isSmartContractFungibleAsset,
  SmartContractFungibleAsset,
} from "@tallyho/tally-background/assets"
import { fixedPointNumberToString } from "@tallyho/tally-background/lib/fixed-point"
import { AsyncThunkFulfillmentType } from "@tallyho/tally-background/redux-slices/utils"
import logger from "@tallyho/tally-background/lib/logger"
import { Redirect, useLocation } from "react-router-dom"
import { normalizeEVMAddress } from "@tallyho/tally-background/lib/utils"
import { CompleteAssetAmount } from "@tallyho/tally-background/redux-slices/accounts"
import { sameNetwork } from "@tallyho/tally-background/networks"
import { selectDefaultNetworkFeeSettings } from "@tallyho/tally-background/redux-slices/selectors/transactionConstructionSelectors"
import { selectSlippageTolerance } from "@tallyho/tally-background/redux-slices/ui"
import { isNetworkBaseAsset } from "@tallyho/tally-background/redux-slices/utils/asset-utils"
import { ReadOnlyAccountSigner } from "@tallyho/tally-background/services/signing"
import {
  EIP_1559_COMPLIANT_CHAIN_IDS,
  NETWORKS_SUPPORTING_SWAPS,
} from "@tallyho/tally-background/constants"
import {
  PriceDetails,
  SwapQuoteRequest,
} from "@tallyho/tally-background/redux-slices/utils/0x-swap-utils"
import CorePage from "../components/Core/CorePage"
import SharedAssetInput from "../components/Shared/SharedAssetInput"
import SharedButton from "../components/Shared/SharedButton"
import SharedSlideUpMenu from "../components/Shared/SharedSlideUpMenu"
import SwapQuote from "../components/Swap/SwapQuote"
import SharedActivityHeader from "../components/Shared/SharedActivityHeader"
import {
  useBackgroundDispatch,
  useBackgroundSelector,
  useSkipFirstRenderEffect,
} from "../hooks"
import SwapRewardsCard from "../components/Swap/SwapRewardsCard"
import SharedIcon from "../components/Shared/SharedIcon"
import SharedBanner from "../components/Shared/SharedBanner"
import ReadOnlyNotice from "../components/Shared/ReadOnlyNotice"
import SharedLoadingDoggo from "../components/Shared/SharedLoadingDoggo"

// FIXME Unify once asset similarity code is unified.
function isSameAsset(asset1: AnyAsset, asset2: AnyAsset) {
  if (typeof asset1 === "undefined" || typeof asset2 === "undefined") {
    return false
  }

  if (
    isSmartContractFungibleAsset(asset1) &&
    isSmartContractFungibleAsset(asset2)
  ) {
    return (
      normalizeEVMAddress(asset1.contractAddress) ===
      normalizeEVMAddress(asset2.contractAddress)
    )
  }

  if (
    isSmartContractFungibleAsset(asset1) ||
    isSmartContractFungibleAsset(asset2)
  ) {
    return false
  }

  return asset1.symbol === asset2.symbol
}

export default function Swap(): ReactElement {
  const { t } = useTranslation()
  const dispatch = useBackgroundDispatch()
  const location = useLocation<
    { symbol: string; contractAddress?: string } | undefined
  >()

  const currentNetwork = useBackgroundSelector(selectCurrentNetwork)

  const accountBalances = useBackgroundSelector(selectCurrentAccountBalances)

  const selectedNetwork = useBackgroundSelector(selectCurrentNetwork)

  const currentAccountSigner = useBackgroundSelector(selectCurrentAccountSigner)

  const isReadOnlyAccount = currentAccountSigner === ReadOnlyAccountSigner

  const assets = useBackgroundSelector(getAssetsState)

  const mainCurrencySign = useBackgroundSelector(selectMainCurrencySign)

  const [priceDetails, setPriceDetails] = useState<PriceDetails | undefined>(
    undefined
  )

  // TODO We're special-casing ETH here in an odd way. Going forward, we should
  // filter by current chain and better handle network-native base assets
  const ownedSellAssetAmounts =
    accountBalances?.assetAmounts.filter(
      (
        assetAmount
      ): assetAmount is CompleteAssetAmount<
        SmartContractFungibleAsset | FungibleAsset
      > =>
        isSmartContractFungibleAsset(assetAmount.asset) ||
        assetAmount.asset.symbol === currentNetwork.baseAsset.symbol
    ) ?? []

  const {
    symbol: locationAssetSymbol,
    contractAddress: locationAssetContractAddress,
  } = location.state ?? {}
  const locationAsset = ownedSellAssetAmounts.find(
    ({ asset: candidateAsset }) => {
      if (typeof locationAssetContractAddress !== "undefined") {
        return (
          isSmartContractFungibleAsset(candidateAsset) &&
          normalizeEVMAddress(candidateAsset.contractAddress) ===
            normalizeEVMAddress(locationAssetContractAddress)
        )
      }
      return candidateAsset.symbol === locationAssetSymbol
    }
  )?.asset

  const [confirmationMenu, setConfirmationMenu] = useState(false)

  const savedQuoteRequest = useBackgroundSelector(selectLatestQuoteRequest)
  const {
    assets: { sellAsset: savedSellAsset, buyAsset: savedBuyAsset },
    amount: savedSwapAmount,
  } = (!locationAsset && savedQuoteRequest) || {
    // ^ If coming from an asset item swap button, let the UI start fresh
    assets: { sellAsset: locationAsset },
  }

  const [sellAsset, setSellAsset] = useState(savedSellAsset)
  const [buyAsset, setBuyAsset] = useState(savedBuyAsset)
  const [sellAmount, setSellAmount] = useState(
    typeof savedSwapAmount !== "undefined" && "sellAmount" in savedSwapAmount
      ? savedSwapAmount.sellAmount
      : ""
  )
  const [buyAmount, setBuyAmount] = useState(
    typeof savedSwapAmount !== "undefined" && "buyAmount" in savedSwapAmount
      ? savedSwapAmount.buyAmount
      : ""
  )
  const [needsApproval, setNeedsApproval] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState<string | undefined>(
    undefined
  )

  useSkipFirstRenderEffect(() => {
    setSellAsset(undefined)
    setBuyAsset(undefined)
    setSellAmount("")
    setBuyAmount("")
  }, [currentNetwork.chainID, dispatch])

  const buyAssets = useBackgroundSelector((state) => {
    // Some type massaging needed to remind TypeScript how these types fit
    // together.
    const knownAssets: AnyAsset[] = state.assets
    return knownAssets.filter(
      (asset): asset is SmartContractFungibleAsset | FungibleAsset => {
        // We don't want to buy the same asset we're selling.
        if (asset.symbol === sellAsset?.symbol) {
          return false
        }

        if (isSmartContractFungibleAsset(asset)) {
          if (sameNetwork(asset.homeNetwork, currentNetwork)) {
            return true
          }
        }
        if (
          // Explicitly add a network's base asset.
          isNetworkBaseAsset(asset, currentNetwork)
        ) {
          return true
        }
        return false
      }
    )
  })

  const sellAssetAmounts = (
    ownedSellAssetAmounts.some(
      ({ asset }) =>
        typeof sellAsset !== "undefined" && isSameAsset(asset, sellAsset)
    )
      ? ownedSellAssetAmounts
      : ownedSellAssetAmounts.concat(
          typeof sellAsset === "undefined"
            ? []
            : [
                {
                  asset: sellAsset,
                  amount: 0n,
                  decimalAmount: 0,
                  localizedDecimalAmount: "0",
                },
              ]
        )
  ).filter(
    (sellAssetAmount) => sellAssetAmount.asset.symbol !== buyAsset?.symbol
  )

  useEffect(() => {
    if (typeof sellAsset !== "undefined") {
      const isSelectedSellAssetInSellAssets = sellAssetAmounts.some(
        ({ asset }) => isSameAsset(asset, sellAsset)
      )

      if (!isSelectedSellAssetInSellAssets) {
        sellAssetAmounts.push({
          asset: sellAsset,
          amount: 0n,
          decimalAmount: 0,
          localizedDecimalAmount: "0",
        })
      }
    }
  }, [sellAsset, sellAssetAmounts])

  useEffect(() => {
    setPriceDetails(undefined)
  }, [sellAsset, buyAsset, dispatch])

  const inProgressApprovalContract = useBackgroundSelector(
    selectInProgressApprovalContract
  )
  const isApprovalInProgress =
    sellAsset &&
    "contractAddress" in sellAsset &&
    normalizeEVMAddress(inProgressApprovalContract || "0x") ===
      normalizeEVMAddress(sellAsset?.contractAddress || "0x")

  const [sellAmountLoading, setSellAmountLoading] = useState(false)
  const [buyAmountLoading, setBuyAmountLoading] = useState(false)

  const [swapTransactionSettings, setSwapTransactionSettings] = useState({
    slippageTolerance: useBackgroundSelector(selectSlippageTolerance),
    networkSettings: useBackgroundSelector(selectDefaultNetworkFeeSettings),
  })

  const latestQuoteRequest = useRef<SwapQuoteRequest | undefined>(
    savedQuoteRequest
  )

  const finalQuote = useBackgroundSelector((state) => state.swap.finalQuote)

  /* We have to watch the state to determine when the quote is fetched */
  useEffect(() => {
    if (typeof finalQuote !== "undefined") {
      // Now open the asset menu
      setConfirmationMenu(true)
    }
  }, [finalQuote])

  const getFinalQuote = async () => {
    // The final quote requires a previous non-final quote having been
    // requested; this is also guarded at the button (by disabling the button).
    if (typeof latestQuoteRequest.current === "undefined") {
      return false
    }

    dispatch(fetchSwapQuote(latestQuoteRequest.current))

    return true
  }

  const approveAsset = async () => {
    if (typeof sellAsset === "undefined") {
      logger.error(t("swap.error.noSellAsset"))
      return
    }
    if (typeof approvalTarget === "undefined") {
      logger.error(t("swap.error.noApprovalTarget"))
      return
    }
    if (!isSmartContractFungibleAsset(sellAsset)) {
      logger.error(t("swap.error.nonContractAsset"), sellAsset)
      return
    }

    await dispatch(
      approveTransfer({
        assetContractAddress: sellAsset.contractAddress,
        approvalTarget,
      })
    )
  }

  const updateSwapData = useCallback(
    async (
      requestedQuote: "buy" | "sell",
      amount: string,
      // Fixed asset in the swap.
      fixedAsset?: SmartContractFungibleAsset | FungibleAsset | undefined,
      quoteAsset?: SmartContractFungibleAsset | FungibleAsset | undefined
    ): Promise<void> => {
      if (requestedQuote === "sell") {
        setBuyAmount("")
      } else {
        setSellAmount("")
      }

      const quoteSellAsset =
        requestedQuote === "buy"
          ? fixedAsset ?? sellAsset
          : quoteAsset ?? sellAsset
      const quoteBuyAsset =
        requestedQuote === "sell" && typeof fixedAsset !== "undefined"
          ? fixedAsset ?? buyAsset
          : quoteAsset ?? buyAsset

      // Swap amounts can't update unless both sell and buy assets are specified.
      if (
        typeof quoteSellAsset === "undefined" ||
        typeof quoteBuyAsset === "undefined" ||
        amount.trim() === ""
      ) {
        return
      }

      const quoteRequest: SwapQuoteRequest = {
        assets: {
          sellAsset: quoteSellAsset,
          buyAsset: quoteBuyAsset,
        },
        amount:
          requestedQuote === "sell"
            ? { sellAmount: amount }
            : { buyAmount: amount },
        slippageTolerance: swapTransactionSettings.slippageTolerance,
        gasPrice: EIP_1559_COMPLIANT_CHAIN_IDS.has(selectedNetwork.chainID)
          ? swapTransactionSettings.networkSettings.values.maxFeePerGas
          : swapTransactionSettings.networkSettings.values.gasPrice ?? 0n,
        network: selectedNetwork,
      }

      if (
        "buyAmount" in quoteRequest.amount &&
        Number(quoteRequest.amount.buyAmount) === 0
      ) {
        setSellAmount("")
        return
      }

      if (
        "sellAmount" in quoteRequest.amount &&
        Number(quoteRequest.amount.sellAmount) === 0
      ) {
        setBuyAmount("")
        return
      }

      // If there's a different quote in progress, reset all loading states as
      // we're about to replace it.
      if (latestQuoteRequest.current !== quoteRequest) {
        setBuyAmountLoading(false)
        setSellAmountLoading(false)
      }

      if (requestedQuote === "sell") {
        setBuyAmountLoading(true)
      } else {
        setSellAmountLoading(true)
      }

      latestQuoteRequest.current = quoteRequest
      const {
        quote,
        needsApproval: quoteNeedsApproval,
        priceDetails: quotePriceDetails,
      } = ((await dispatch(
        fetchSwapPrice({ quoteRequest, assets })
      )) as unknown as AsyncThunkFulfillmentType<typeof fetchSwapPrice>) ?? {
        quote: undefined,
        needsApproval: false,
      }

      // Only proceed if the quote we just got is the same one we were looking for.
      if (latestQuoteRequest.current === quoteRequest) {
        if (typeof quote === "undefined") {
          // If there's no quote, clear states and abort.
          setBuyAmountLoading(false)
          setSellAmountLoading(false)
          setNeedsApproval(false)
          setApprovalTarget(undefined)
          latestQuoteRequest.current = undefined

          // TODO set an error on the buy or sell state.

          return
        }

        if (
          swapTransactionSettings.networkSettings.gasLimit !== BigInt(quote.gas)
        ) {
          setSwapTransactionSettings({
            ...swapTransactionSettings,
            networkSettings: {
              ...swapTransactionSettings.networkSettings,
              gasLimit: BigInt(quote.gas),
              suggestedGasLimit: BigInt(quote.estimatedGas),
            },
          })
        }
        setNeedsApproval(quoteNeedsApproval)
        setApprovalTarget(quote.allowanceTarget)
        setPriceDetails(quotePriceDetails)

        if (requestedQuote === "sell") {
          setBuyAmount(
            fixedPointNumberToString({
              amount: BigInt(quote.buyAmount),
              decimals: quoteBuyAsset.decimals,
            })
          )
          setBuyAmountLoading(false)
        } else {
          setSellAmount(
            fixedPointNumberToString({
              amount: BigInt(quote.sellAmount),
              decimals: quoteSellAsset.decimals,
            })
          )
          setSellAmountLoading(false)
        }
      }
    },
    [
      sellAsset,
      buyAsset,
      swapTransactionSettings,
      selectedNetwork,
      dispatch,
      assets,
    ]
  )

  const updateSellAsset = useCallback(
    (asset: SmartContractFungibleAsset | FungibleAsset) => {
      setSellAsset(asset)

      if (buyAsset && buyAmount !== "") {
        // Updating the sell asset quotes the new sell asset against the existing
        // buy amount.
        updateSwapData("buy", buyAmount, asset)
      }
    },
    [buyAmount, buyAsset, updateSwapData]
  )
  const updateBuyAsset = useCallback(
    (asset: SmartContractFungibleAsset | FungibleAsset) => {
      setBuyAsset(asset)

      if (sellAsset && sellAmount !== "") {
        // Updating the buy asset quotes the new buy asset against the existing
        // sell amount.
        updateSwapData("sell", sellAmount, asset)
      }
    },
    [sellAmount, sellAsset, updateSwapData]
  )

  const flipSwap = useCallback(() => {
    setSellAsset(buyAsset)
    setBuyAsset(sellAsset)
    setSellAmount(buyAmount)

    updateSwapData("sell", buyAmount, sellAsset, buyAsset)
  }, [buyAmount, buyAsset, sellAsset, updateSwapData])

  useEffect(() => {
    if (
      typeof savedSwapAmount !== "undefined" &&
      typeof savedBuyAsset !== "undefined" &&
      typeof savedSellAsset !== "undefined"
    ) {
      updateSwapData(
        "sellAmount" in savedSwapAmount ? "sell" : "buy",
        "sellAmount" in savedSwapAmount
          ? savedSwapAmount.sellAmount
          : savedSwapAmount.buyAmount,
        "sellAmount" in savedSwapAmount ? savedBuyAsset : savedSellAsset
      )
    } else {
      dispatch(clearSwapQuote())
    }
    // We want to run this in three cases:
    // - Once at component load, to make sure the flip of the quote is set
    //   correctly.
    // - When swap transaction settings change, to update non-swap details.
    // - When approval-in-progress status changes, to update the approval
    //   status in the UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapTransactionSettings, isApprovalInProgress])

  const isSwapSupportedByNetwork = () =>
    NETWORKS_SUPPORTING_SWAPS.has(selectedNetwork.chainID)

  if (!isSwapSupportedByNetwork()) {
    return <Redirect to="/" />
  }

  return (
    <>
      <CorePage>
        <SharedSlideUpMenu
          isOpen={typeof finalQuote !== "undefined"}
          close={() => {
            dispatch(clearSwapQuote())
          }}
          size="large"
        >
          {typeof sellAsset !== "undefined" &&
          typeof buyAsset !== "undefined" &&
          typeof finalQuote !== "undefined" ? (
            <SwapQuote
              sellAsset={sellAsset}
              buyAsset={buyAsset}
              finalQuote={finalQuote}
              swapTransactionSettings={swapTransactionSettings}
            />
          ) : (
            <></>
          )}
        </SharedSlideUpMenu>
        <div className="standard_width swap_wrap">
          <div className="header">
            <SharedActivityHeader label={t("swap.title")} activity="swap" />
            <ReadOnlyNotice isLite />
            {isEnabled(FeatureFlags.HIDE_TOKEN_FEATURES) ? (
              <></>
            ) : (
              !isEnabled(FeatureFlags.HIDE_SWAP_REWARDS) && (
                // TODO: Add onClick function after design is ready
                <SharedIcon
                  icon="cog@2x.png"
                  width={20}
                  color="var(--green-60)"
                  hoverColor="#fff"
                  customStyles="margin: 17px 0 25px;"
                />
              )
            )}
          </div>
          {isEnabled(FeatureFlags.HIDE_TOKEN_FEATURES) ? (
            <></>
          ) : (
            isEnabled(FeatureFlags.HIDE_SWAP_REWARDS) && (
              <SharedBanner
                id="swap_rewards"
                canBeClosed
                icon="notif-announcement"
                iconColor="var(--link)"
                customStyles="margin-bottom: 16px"
              >
                {t("swap.swapRewardsTeaser")}
              </SharedBanner>
            )
          )}
          <div className="form">
            <div className="form_input">
              <SharedAssetInput<SmartContractFungibleAsset | FungibleAsset>
                currentNetwork={currentNetwork}
                amount={sellAmount}
                amountMainCurrency={priceDetails?.sellCurrencyAmount}
                showPriceDetails
                isPriceDetailsLoading={!priceDetails}
                assetsAndAmounts={sellAssetAmounts}
                selectedAsset={sellAsset}
                isDisabled={sellAmountLoading}
                mainCurrencySign={mainCurrencySign}
                onAssetSelect={updateSellAsset}
                onAmountChange={(newAmount, error) => {
                  setPriceDetails(undefined)
                  setSellAmount(newAmount)
                  if (typeof error === "undefined") {
                    updateSwapData("sell", newAmount)
                  }
                }}
                label={t("swap.from")}
              />
            </div>
            <button className="icon_change" type="button" onClick={flipSwap}>
              {t("swap.switchAssets")}
            </button>
            <div className="form_input">
              <SharedAssetInput<SmartContractFungibleAsset | FungibleAsset>
                currentNetwork={currentNetwork}
                amount={buyAmount}
                amountMainCurrency={priceDetails?.buyCurrencyAmount}
                priceImpact={priceDetails?.priceImpact}
                isPriceDetailsLoading={!priceDetails}
                showPriceDetails
                // FIXME Merge master asset list with account balances.
                assetsAndAmounts={buyAssets.map((asset) => ({ asset }))}
                selectedAsset={buyAsset}
                isDisabled={buyAmountLoading}
                showMaxButton={false}
                mainCurrencySign={mainCurrencySign}
                onAssetSelect={updateBuyAsset}
                onAmountChange={(newAmount, error) => {
                  setPriceDetails(undefined)
                  setBuyAmount(newAmount)
                  if (typeof error === "undefined") {
                    updateSwapData("buy", newAmount)
                  }
                }}
                label={t("swap.to")}
              />
              {priceDetails === undefined &&
              (sellAmount || buyAmount) &&
              buyAsset &&
              sellAsset ? (
                <SharedLoadingDoggo
                  size={54}
                  message="Fetching price"
                  margin="15px 0 0 0"
                />
              ) : null}
            </div>
            <div className="settings_wrap">
              {!isEnabled(FeatureFlags.HIDE_SWAP_REWARDS) ? (
                <SwapRewardsCard />
              ) : null}
            </div>
            <div className="footer standard_width_padded">
              {
                // Would welcome an alternative here---this is pretty gnarly.
                // eslint-disable-next-line no-nested-ternary
                needsApproval ? (
                  isApprovalInProgress ? (
                    <SharedButton type="primary" size="large" isDisabled>
                      {t("swap.waitingForApproval")}
                    </SharedButton>
                  ) : (
                    <SharedButton
                      type="primary"
                      size="large"
                      isDisabled={
                        isReadOnlyAccount ||
                        typeof latestQuoteRequest.current === "undefined" ||
                        sellAmountLoading ||
                        buyAmountLoading
                      }
                      onClick={approveAsset}
                      showLoadingOnClick={!confirmationMenu}
                    >
                      {t("swap.approveAsset")}
                    </SharedButton>
                  )
                ) : (
                  <SharedButton
                    type="primary"
                    size="large"
                    isDisabled={
                      isReadOnlyAccount ||
                      typeof latestQuoteRequest.current === "undefined" ||
                      sellAmountLoading ||
                      buyAmountLoading ||
                      !sellAsset ||
                      !sellAmount ||
                      !buyAsset ||
                      !buyAmount
                    }
                    onClick={getFinalQuote}
                    showLoadingOnClick={!confirmationMenu}
                  >
                    {t("swap.getFinalQuote")}
                  </SharedButton>
                )
              }
            </div>
          </div>
        </div>
      </CorePage>
      <style jsx>
        {`
          .swap_wrap {
            margin-top: -9px;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .network_fee_group {
            display: flex;
            margin-bottom: 29px;
          }
          .label_right {
            margin-right: 6px;
          }
          .divider {
            width: 384px;
            border-bottom: 1px solid #000000;
            margin-left: -16px;
          }
          .total_amount_number {
            width: 150px;
            height: 32px;
            color: #e7296d;
            font-size: 22px;
            font-weight: 500;
            line-height: 32px;
          }
          .footer {
            display: flex;
            justify-content: center;
            margin-top: 24px;
          }
          .total_label {
            width: 33px;
            height: 17px;
            color: var(--green-60);
            font-size: 14px;
            font-weight: 400;
            letter-spacing: 0.42px;
            line-height: 16px;
          }
          .icon_change {
            display: block;
            background: url("./images/change@2x.png") center no-repeat;
            background-size: 20px 20px;
            width: 20px;
            height: 20px;
            padding: 8px;
            border: 3px solid var(--hunter-green);
            background-color: var(--green-95);
            border-radius: 70%;
            margin: 0 auto;
            margin-top: -5px;
            margin-bottom: -32px;
            position: relative;
            z-index: 1;
            font-size: 0;
          }
          .settings_wrap {
            margin-top: 16px;
          }
        `}
      </style>
    </>
  )
}
