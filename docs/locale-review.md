# Locale review — English ↔ Georgian

Source files:
- `frontend/locales/en.json`
- `frontend/locales/ka.json`

Total keys: 94

Mark anything you want corrected in the **Notes** column (or paste the corrected Georgian directly). I will apply the fixes in a follow-up commit.

## Navigation  (`nav.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `nav.dashboard` | Dashboard | მთავარი |  |
| `nav.calendar` | Calendar | კალენდარი |  |
| `nav.library` | Library | ბიბლიოთეკა |  |
| `nav.statistics` | Statistics | სტატისტიკა |  |
| `nav.admin` | Admin Panel | ადმინ. პანელი |  |
| `nav.logout` | Log out | გასვლა |  |
| `nav.language` | Language | ენა |  |

## Authentication  (`auth.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `auth.login` | Log In | შესვლა |  |
| `auth.username` | Username | მომხმარებელი |  |
| `auth.password` | Password | პაროლი |  |
| `auth.loginButton` | Sign In | შესვლა |  |
| `auth.loginError` | Invalid username or password | არასწორი მომხმარებელი ან პაროლი |  |

## Dashboard  (`dashboard.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `dashboard.title` | Dashboard | მთავარი |  |
| `dashboard.selectEvent` | Select event | აირჩიეთ ღონისძიება |  |
| `dashboard.noEvents` | No events available | ღონისძიებები არ არის |  |
| `dashboard.sections` | Required Sections | საჭირო სექციები |  |
| `dashboard.status` | Status | სტატუსი |  |
| `dashboard.lastUpdated` | Last Updated | ბოლო განახლება |  |
| `dashboard.actions` | Actions | მოქმედებები |  |

## Common buttons & verbs  (`common.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `common.save` | Save | შენახვა |  |
| `common.cancel` | Cancel | გაუქმება |  |
| `common.confirm` | Confirm | დადასტურება |  |
| `common.close` | Close | დახურვა |  |
| `common.delete` | Delete | წაშლა |  |
| `common.edit` | Edit | რედაქტირება |  |
| `common.create` | Create | შექმნა |  |
| `common.add` | Add | დამატება |  |
| `common.remove` | Remove | ამოშლა |  |
| `common.back` | Back | უკან |  |
| `common.yes` | Yes | კი |  |
| `common.no` | No | არა |  |
| `common.loading` | Loading... | იტვირთება... |  |
| `common.search` | Search | ძებნა |  |
| `common.from` | From | დან |  |
| `common.to` | To | მდე |  |
| `common.all` | All | ყველა |  |
| `common.actions` | Actions | მოქმედებები |  |
| `common.submit` | Submit | გაგზავნა |  |
| `common.approve` | Approve | დადასტურება |  |
| `common.return` | Return | დაბრუნება |  |

## Roles  (`roles.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `roles.ADMIN` | Admin | ადმინი |  |
| `roles.PROTOCOL` | Protocol | პროტოკოლი |  |
| `roles.DEPUTY` | Deputy | მოადგილე |  |
| `roles.SUPERVISOR` | Supervisor | ზედამხედველი |  |
| `roles.SUPER_COLLABORATOR` | Super-Collaborator | სუპერ-კოლაბორატორი |  |
| `roles.COLLABORATOR` | Collaborator | კოლაბორატორი |  |
| `roles.CURATOR` | Curator | კურატორი |  |
| `roles.RECEIVING_SUPER_COLLABORATOR` | Super-Collaborator | სუპერ-კოლაბორატორი |  |
| `roles.RECEIVING_SUPERVISOR` | Supervisor | ზედამხედველი |  |

## Section / workflow statuses  (`status.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `status.draft` | Draft | პროექტი |  |
| `status.submitted_to_super_collaborator` | At Super-Collaborator | სუპერ-კოლაბორატორთან |  |
| `status.returned_by_super_collaborator` | Returned by Super-Collaborator | დაბრუნებული სუპერ-კოლაბორატორის მიერ |  |
| `status.approved_by_super_collaborator` | Approved (Super-Collaborator) | დადასტურებული (სუპერ-კოლაბორატორი) |  |
| `status.submitted_to_curator` | At Curator | კურატორთან |  |
| `status.returned_by_curator` | Returned by Curator | დაბრუნებული კურატორის მიერ |  |
| `status.approved_by_curator` | Approved (Curator) | დადასტურებული (კურატორი) |  |
| `status.submitted_to_supervisor` | At Supervisor | ზედამხედველთან |  |
| `status.returned_by_supervisor` | Returned by Supervisor | დაბრუნებული ზედამხედველის მიერ |  |
| `status.approved_by_supervisor` | Approved (Supervisor) | დადასტურებული (ზედამხედველი) |  |
| `status.submitted_to_deputy` | At Deputy | მოადგილესთან |  |
| `status.returned_by_deputy` | Returned by Deputy | დაბრუნებული მოადგილის მიერ |  |
| `status.approved_by_deputy` | Approved (Deputy) | დადასტურებული (მოადგილე) |  |
| `status.submitted_to_receiving_super_collaborator` | At Super-Collaborator (Review) | სუპერ-კოლაბორატორთან (განხილვა) |  |
| `status.returned_by_receiving_super_collaborator` | Returned by Super-Collaborator (Review) | დაბრუნებული სუპერ-კოლაბორატორის მიერ (განხილვა) |  |
| `status.approved_by_receiving_super_collaborator` | Approved (Super-Collaborator Review) | დადასტურებული (სუპერ-კოლაბორატორის განხილვა) |  |
| `status.submitted_to_receiving_supervisor` | At Supervisor (Review) | ზედამხედველთან (განხილვა) |  |
| `status.returned_by_receiving_supervisor` | Returned by Supervisor (Review) | დაბრუნებული ზედამხედველის მიერ (განხილვა) |  |
| `status.approved_by_receiving_supervisor` | Approved (Supervisor Review) | დადასტურებული (ზედამხედველის განხილვა) |  |
| `status.submitted_to_amending_ds` | Amendment in progress (DS) | მიმდინარეობს რედაქტირება (DS) |  |
| `status.approved_by_ds_amendment` | Amended (DS) | შესწორებული (DS) |  |

## Language names  (`lang.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `lang.EN` | English | English |  |
| `lang.FR` | Français | Français |  |
| `lang.AR` | العربية | العربية |  |
| `lang.ES` | Español | Español |  |
| `lang.RU` | Русский | Русский |  |
| `lang.ZH` | 中文 | 中文 |  |
| `lang.PT` | Português | Português |  |
| `lang.DE` | Deutsch | Deutsch |  |
| `lang.KA` | ქართული | ქართული |  |

## Statistics page  (`statistics.*`)

| Key | English | Georgian | Notes |
| --- | --- | --- | --- |
| `statistics.country` | Country | ქვეყანა |  |
| `statistics.searchCountry` | Search country... | ქვეყნის ძებნა... |  |
| `statistics.generate` | Generate | გენერაცია |  |
| `statistics.mainExportProducts` | Main Export Products | ძირითადი საექსპორტო პროდუქცია |  |
| `statistics.product` | Product (HS 4-digit) | პროდუქცია (HS 4-ნიშნა) |  |
| `statistics.value` | Value, mln $ | ღირებულება, მლნ. $ |  |
| `statistics.change` | Change, % | ცვლილება, % |  |
| `statistics.reexportShare` | Re-export share, % | რეექსპორტის წილი, % |  |
| `statistics.total` | Total (displayed products) | სულ (ნაჩვენები პროდუქცია) |  |
| `statistics.noData` | No data found | მონაცემები ვერ მოიძებნა |  |
| `statistics.tradeTab` | Trade | ვაჭრობა |  |
| `statistics.tourismTab` | Tourism | ტურიზმი |  |
| `statistics.investmentsTab` | Investments | ინვესტიციები |  |
| `statistics.companiesTab` | Companies | კომპანიები |  |
| `statistics.appendixTab` | Appendix | დანართი |  |
