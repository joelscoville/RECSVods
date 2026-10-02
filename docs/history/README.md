# History

How the archive was built: the reviews of each recording, acceptance records, run logs and the
implementation prompts. They describe the **earlier format**: one `services/YYYY/<id>/service.yaml` per
service, with free-form chapters, subsections, speakers and keywords, plus committed chapter vectors and
internal passage files. That format was replaced by one file per recording (`services/<id>.yaml`, see
[the recording format](../editing-services.md)); these documents are kept as a record and are not updated.

The transcripts those passage files held are kept in `transcripts/<id>.yaml`. The site never reads them;
the build only checks that none of their wording appears in the published site.
